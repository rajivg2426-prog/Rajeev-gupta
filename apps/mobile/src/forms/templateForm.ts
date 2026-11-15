// Turns template fields (sections[].fields[] or parties[].fields[]) into
// react-hook-form values + a zod schema. The server's validateForm is the
// source of truth; this only catches obvious mistakes before a round trip.
import { z } from "zod";
import { paiseToRupeesInput, rupeesToPaise } from "../api/money";
import type { FieldType, FormData, ShowIf, TemplateField, TemplateSection } from "../api/types";

/** Field types this placeholder form can render. Others are skipped with a TODO. */
export const SUPPORTED_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "text",
  "textarea",
  "address",
  "number",
  "percent",
  "money",
  "date",
  "select",
  "radio",
  "checkbox",
  "phone",
  "email",
  "pincode",
  "pan",
  "aadhaarLast4",
]);
// TODO(form): "repeater" (e.g. fixtures list) is not rendered yet.

/** What the inputs hold: strings for text boxes (money in rupees), booleans for checkboxes. */
export type RawValue = string | boolean;
export type RawSection = Record<string, RawValue>;
export type RawForm = Record<string, RawSection>;

const NUMERIC: FieldType[] = ["number", "percent"];
const BUILT_IN: Partial<Record<FieldType, RegExp>> = {
  phone: /^(\+91)?[6-9]\d{9}$/,
  pincode: /^[1-9]\d{5}$/,
  pan: /^[A-Z]{5}\d{4}[A-Z]$/,
  aadhaarLast4: /^\d{4}$/,
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
};

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Mirrors the server's showIf ops. Works on raw values (strings/booleans). */
export function isVisible(showIf: ShowIf | undefined, root: unknown): boolean {
  if (!showIf) return true;
  const v = getPath(root, showIf.field);
  const n = (x: unknown) => (typeof x === "string" && x.trim() !== "" ? Number(x) : (x as number));
  switch (showIf.op) {
    case "eq":
      return v === showIf.value;
    case "neq":
      return v !== showIf.value;
    case "gt":
      return n(v) > (showIf.value as number);
    case "gte":
      return n(v) >= (showIf.value as number);
    case "lt":
      return n(v) < (showIf.value as number);
    case "lte":
      return n(v) <= (showIf.value as number);
    case "in":
      return Array.isArray(showIf.value) && showIf.value.includes(v);
    case "truthy":
      return !!v;
    case "falsy":
      return !v;
  }
}

/** API value (paise, numbers) or template default -> raw input value. */
export function toRaw(f: TemplateField, apiValue: unknown): RawValue {
  const v = apiValue === undefined || apiValue === null ? f.default : apiValue;
  if (f.type === "checkbox") return v === true;
  if (v === undefined || v === null) return "";
  if (f.type === "money") return typeof v === "number" ? paiseToRupeesInput(v) : String(v);
  return String(v);
}

/** Raw input value -> API value (undefined means "leave out"). */
export function fromRaw(f: TemplateField, raw: RawValue | undefined): unknown {
  if (f.type === "checkbox") return raw === true;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s === "") return undefined;
  if (f.type === "money") return rupeesToPaise(s) ?? s;
  if (NUMERIC.includes(f.type)) return Number.isFinite(Number(s)) ? Number(s) : s;
  if (f.type === "phone") return s.startsWith("+") ? s : `+91${s}`;
  if (f.type === "pan") return s.toUpperCase();
  return s;
}

/** One field's client-side check. Returns an error message or null. */
export function checkField(f: TemplateField, raw: RawValue | undefined): string | null {
  if (f.type === "checkbox") return null;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s === "") return f.required ? `${f.label} is required` : null;
  const val = f.validation ?? {};
  const msg = (fallback: string) => val.message ?? fallback;
  if (f.type === "money") {
    const p = rupeesToPaise(s);
    if (p === null) return `${f.label}: enter an amount in rupees`;
    if (val.min !== undefined && p < val.min) return msg(`${f.label} must be at least ₹${val.min / 100}`);
    if (val.max !== undefined && p > val.max) return msg(`${f.label} must be at most ₹${val.max / 100}`);
    return null;
  }
  if (NUMERIC.includes(f.type)) {
    const num = Number(s);
    if (!Number.isFinite(num)) return `${f.label} must be a number`;
    if (val.min !== undefined && num < val.min) return msg(`${f.label} must be at least ${val.min}`);
    if (val.max !== undefined && num > val.max) return msg(`${f.label} must be at most ${val.max}`);
    return null;
  }
  const re = val.pattern ? new RegExp(val.pattern) : BUILT_IN[f.type];
  const candidate = f.type === "pan" ? s.toUpperCase() : s;
  if (re && !re.test(candidate)) return msg(`${f.label} is not valid`);
  if (val.minLength !== undefined && s.length < val.minLength) return msg(`${f.label} is too short`);
  if (val.maxLength !== undefined && s.length > val.maxLength) return msg(`${f.label} is too long`);
  if (f.options && !f.options.some((o) => o.value === s)) return `${f.label}: choose one of the options`;
  return null;
}

const rawSectionSchema = z.record(z.string(), z.union([z.string(), z.boolean()]));

/** zod schema for the whole details form ({sectionId: {fieldId: raw}}). */
export function sectionsSchema(sections: TemplateSection[]) {
  return z.record(z.string(), rawSectionSchema).superRefine((form, ctx) => {
    for (const s of sections) {
      if (!isVisible(s.showIf, form)) continue;
      for (const f of s.fields) {
        if (!SUPPORTED_TYPES.has(f.type) || !isVisible(f.showIf, form)) continue;
        const err = checkField(f, form[s.id]?.[f.id]);
        if (err) ctx.addIssue({ code: "custom", path: [s.id, f.id], message: err });
      }
    }
  });
}

/** zod schema for a flat list of fields (party details). */
export function fieldsSchema(fields: TemplateField[]) {
  return rawSectionSchema.superRefine((values, ctx) => {
    for (const f of fields) {
      if (!SUPPORTED_TYPES.has(f.type)) continue;
      const err = checkField(f, values[f.id]);
      if (err) ctx.addIssue({ code: "custom", path: [f.id], message: err });
    }
  });
}

export function rawFromApi(sections: TemplateSection[], form: FormData | undefined): RawForm {
  const out: RawForm = {};
  for (const s of sections) {
    out[s.id] = {};
    for (const f of s.fields) if (SUPPORTED_TYPES.has(f.type)) out[s.id][f.id] = toRaw(f, form?.[s.id]?.[f.id]);
  }
  return out;
}

export function apiFromRaw(sections: TemplateSection[], raw: RawForm, previous?: FormData): FormData {
  const out: FormData = {};
  for (const s of sections) {
    // Keep values for fields this form cannot render (e.g. repeaters) instead of wiping them.
    const section: Record<string, unknown> = { ...(previous?.[s.id] ?? {}) };
    for (const f of s.fields) {
      if (!SUPPORTED_TYPES.has(f.type)) continue;
      const v = isVisible(f.showIf, raw) ? fromRaw(f, raw[s.id]?.[f.id]) : undefined;
      if (v === undefined) delete section[f.id];
      else section[f.id] = v;
    }
    out[s.id] = section;
  }
  return out;
}
