// Renders a template + resolved data into a format-neutral document model,
// which html.ts (→ PDF) and docx.ts both consume. Text is rendered once with
// Handlebars in plain-text mode; each output format does its own escaping.
import Handlebars from "handlebars";
import { formatInr, inrInWords, numberToWords } from "../money.ts";
import type { DutyQuote, EStampTransaction, Party, PincodeData } from "../types.ts";
import { evaluate, type DocumentTemplate } from "./template.ts";

const hb = Handlebars.create();
const IST = "Asia/Kolkata";

function asDate(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v).length === 10 ? `${v}T00:00:00+05:30` : String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2026-11-01" + 11 months → "2027-09-30" (calendar dates, no timezone drift). */
export function addMonthsMinusOneDay(startIso: unknown, months: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(startIso ?? ""));
  if (!m || !months) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  // Clamp to the target month's last day (31 Jan + 1 month → 28/29 Feb), then go back one day.
  const lastDay = new Date(Date.UTC(y, mo + months + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(y, mo + months, Math.min(d, lastDay) - 1));
  return end.toISOString().slice(0, 10);
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

hb.registerHelper("inr", (p: unknown) => (typeof p === "number" ? inrInWords(p) : "[amount]"));
hb.registerHelper("inrShort", (p: unknown) => (typeof p === "number" ? formatInr(p) : "[amount]"));
hb.registerHelper("numberWords", (n: unknown) => (typeof n === "number" ? numberToWords(n) : String(n)));
hb.registerHelper("ordinal", (n: unknown) => ordinal(Number(n)));
hb.registerHelper("lower", (s: unknown) => String(s ?? "").toLowerCase().replace(/_/g, "-"));
hb.registerHelper("inc", (n: unknown) => Number(n) + 1);
hb.registerHelper("gt", (a: unknown, b: unknown) => Number(a) > Number(b));
hb.registerHelper("longDate", (v: unknown) => {
  const d = asDate(v);
  if (!d) return "[date]";
  const day = Number(new Intl.DateTimeFormat("en-IN", { day: "numeric", timeZone: IST }).format(d));
  const rest = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: IST }).format(d);
  return `${ordinal(day)} day of ${rest}`;
});
hb.registerHelper("partyDescriptions", (parties: RenderParty[] | undefined) =>
  (parties ?? [])
    .map((p) => `${p.fullName.toUpperCase()}, ${p.relation ?? ""} ${p.relationName ?? ""}, aged about ${p.age ?? "__"} years, residing at ${p.address ?? "__"}`.replace(/\s+,/g, ","))
    .join("; AND "),
);

export interface RenderParty {
  partyId: string;
  role: string;
  sequence: number;
  fullName: string;
  relation?: string;
  relationName?: string;
  age?: number;
  address?: string;
  phoneMasked: string;
  verification: { required: boolean; status: string; channel?: string; verifiedAt?: string };
}

export interface RenderInput {
  template: DocumentTemplate;
  referenceNo: string;
  form: Record<string, any>;
  parties: Party[];
  pincodeData: PincodeData;
  dutyQuote: DutyQuote | null;
  eStamp: EStampTransaction | null;
  executionDate: Date;
}

export interface DocModel {
  title: string;
  referenceNo: string;
  stamped: boolean;
  watermark: string | null;
  preamble: string[];
  recitals: string[];
  clauses: { number: number; heading?: string; text: string }[];
  schedules: { heading?: string; text: string }[];
  signatures: { caption: string; name: string; verifiedLine: string | null; photoBox: boolean }[];
  footerText: string; // contains {{page}}/{{pages}} placeholders for the PDF stamper
  context: Record<string, any>;
}

export function buildContext(input: RenderInput) {
  const { form, pincodeData, eStamp, parties, template } = input;
  const required = new Set(template.verification.requiredRoles);
  const byRole: Record<string, RenderParty[]> = {};
  for (const p of parties) {
    const d = p.details as Record<string, any>;
    (byRole[p.role] ??= []).push({
      partyId: p.id,
      role: p.role,
      sequence: p.sequence,
      fullName: p.fullName,
      relation: d.relation,
      relationName: d.relationName,
      age: d.age,
      address: d.address,
      phoneMasked: `+91******${p.phoneE164.slice(-4)}`,
      verification: {
        required: required.has(p.role),
        status: p.isVerified ? "VERIFIED" : required.has(p.role) ? "PENDING" : "NOT_REQUIRED",
        verifiedAt: p.verifiedAt?.toISOString(),
      },
    });
  }
  const tenancyEndDate = addMonthsMinusOneDay(form.terms?.startDate, Number(form.terms?.termMonths));
  return {
    referenceNo: input.referenceNo,
    form,
    parties: byRole,
    pincodeData,
    dutyQuote: input.dutyQuote,
    executionDate: input.executionDate,
    tenancyEndDate,
    eStamp: eStamp && {
      certificateNo: eStamp.certificateNo ?? "[e-stamp pending]",
      issuedAt: eStamp.issuedAt,
      stampDutyPaise: eStamp.stampDutyPaise,
      dutyPaidBy: eStamp.dutyPaidBy,
      firstParty: eStamp.firstPartyName,
      secondParty: eStamp.secondPartyName,
      provider: eStamp.provider,
    },
  };
}

const render = (tpl: string, ctx: unknown) => hb.compile(tpl, { noEscape: true, strict: false })(ctx).trim();

export function renderDocument(input: RenderInput, verifiedChannel: (partyId: string) => string | undefined = () => undefined): DocModel {
  const t = input.template;
  const ctx = buildContext(input);
  const stateCode = input.pincodeData.stateCode;
  const include = (c: { showIf?: any; states?: string[] }) => evaluate(c.showIf, input.form) && (!c.states || c.states.includes(stateCode));
  const stamped = !!input.eStamp?.certificateNo;

  const signatures: DocModel["signatures"] = [];
  for (const block of t.signatureBlocks) {
    for (const p of (ctx.parties[block.role] ?? []) as RenderParty[]) {
      const party = input.parties.find((x) => x.id === p.partyId)!;
      const ch = verifiedChannel(p.partyId);
      signatures.push({
        caption: `${block.caption}${(ctx.parties[block.role]?.length ?? 0) > 1 ? ` ${p.sequence}` : ""}`,
        name: p.fullName,
        verifiedLine: block.showVerifiedBadge !== false && party.isVerified && party.verifiedAt
          ? `Mobile ${p.phoneMasked} verified via ${ch === "WHATSAPP" ? "WhatsApp" : "SMS"} OTP on ${party.verifiedAt.toLocaleString("en-IN", { timeZone: IST, dateStyle: "medium", timeStyle: "short" })} IST`
          : null,
        photoBox: !!block.showPhotoBox,
      });
    }
  }

  return {
    title: t.title.toUpperCase(),
    referenceNo: input.referenceNo,
    stamped,
    watermark: stamped ? null : t.output.watermarkUntilStamped ?? "DRAFT",
    preamble: render(t.body.preamble, ctx).split(/\n{2,}/),
    recitals: (t.body.recitals ?? []).filter(include).map((c) => render(c.text, ctx)),
    clauses: t.body.clauses.filter(include).map((c, i) => ({ number: i + 1, heading: c.heading, text: render(c.text, ctx) })),
    schedules: (t.body.schedules ?? []).filter(include).map((c) => ({ heading: c.heading, text: render(c.text, ctx) })),
    signatures,
    footerText: t.eStamp.placement?.footerText
      ? render(t.eStamp.placement.footerText.replace(/\{\{(page|pages)\}\}/g, "[[$1]]"), ctx)
      : `Ref ${input.referenceNo} | Page [[page]] of [[pages]]`,
    context: ctx,
  };
}
