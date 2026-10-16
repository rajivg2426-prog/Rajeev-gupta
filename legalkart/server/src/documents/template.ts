// Template loading, JSON-Schema validation, form validation and the small
// condition language used by showIf.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { PartyRole } from "../types.ts";

// ajv-formats ships CJS; under NodeNext the callable is on .default.
const addFormats = addFormatsModule as unknown as typeof addFormatsModule.default;

export type Condition =
  | { field: string; op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "truthy" | "falsy"; value?: unknown }
  | { all: Condition[] } | { any: Condition[] } | { not: Condition };

export interface TemplateField {
  id: string;
  type: string;
  label: string;
  required?: boolean;
  default?: unknown;
  options?: { value: unknown; label: string }[];
  validation?: { pattern?: string; min?: number; max?: number; minLength?: number; maxLength?: number; message?: string };
  showIf?: Condition;
  autofillFrom?: string;
  itemFields?: TemplateField[];
}

export interface Clause { id: string; heading?: string; text: string; showIf?: Condition; states?: string[] }

export interface DocumentTemplate {
  templateKey: string;
  version: string;
  documentType: string;
  title: string;
  jurisdiction: { states: string[]; excludedStates?: string[] };
  legalMeta: { maxTermMonths?: number; eSignPermitted: boolean; lawyerReviewRecommended: boolean; registration: { mandatory: boolean; mandatoryIf?: Condition } };
  parties: { role: PartyRole; label: string; min: number; max: number; otpRequired?: boolean; fields: TemplateField[] }[];
  sections: { id: string; title: string; showIf?: Condition; fields: TemplateField[] }[];
  pincodeBinding: { fieldPath: string; requireSroConfirmation?: boolean; lockStateToJurisdiction?: boolean };
  stampDuty: { inputs: Record<string, string>; dutyPayerRole?: PartyRole };
  eStamp: {
    required: boolean; firstPartyRole: PartyRole; secondPartyRole: PartyRole; dutyPaidByRole: PartyRole; purchasedByRole?: PartyRole;
    descriptionOfDocument: string; propertyDescriptionTemplate?: string; articleCodes: Record<string, string>;
    fulfilmentModes: ("DIGITAL_SELF_PRINT" | "ACC_PRINT_COURIER" | "ACC_PICKUP" | "FRANKING")[];
    placement?: { certificateAsFirstPage?: boolean; footerText?: string; qrOnEveryPage?: boolean };
  };
  verification: {
    requiredRoles: PartyRole[]; optionalRoles?: PartyRole[]; channels: ("SMS" | "WHATSAPP" | "VOICE")[];
    otpTtlSeconds?: number; maxAttempts?: number; blockGenerationUntilVerified: boolean; consentTextVersion?: string;
  };
  body: { preamble: string; recitals?: Clause[]; clauses: Clause[]; schedules?: Clause[] };
  signatureBlocks: { role: PartyRole; caption: string; showPhotoBox?: boolean; showVerifiedBadge?: boolean }[];
  output: { formats: ("PDF" | "DOCX")[]; pageSize: "A4" | "LEGAL"; watermarkUntilStamped?: string; fileNameTemplate?: string };
  disclaimer: { text: string; requireAcknowledgement: boolean };
}

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const readJson = (p: string) => JSON.parse(readFileSync(here(p), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
export const validateTemplateSchema = ajv.compile(readJson("../../../schemas/document-template.schema.json"));
export const validateInstanceSchema = ajv.compile(readJson("../../../schemas/document-instance.schema.json"));

export function loadTemplate(file: string): DocumentTemplate {
  const json = readJson(`../../../templates/${file}`);
  if (!validateTemplateSchema(json)) {
    throw new Error(`Invalid template ${file}: ${ajv.errorsText(validateTemplateSchema.errors)}`);
  }
  return json as DocumentTemplate;
}

export function getPath(obj: unknown, path: string): any {
  return path.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
}

export function evaluate(cond: Condition | undefined, data: unknown): boolean {
  if (!cond) return true;
  if ("all" in cond) return cond.all.every((c) => evaluate(c, data));
  if ("any" in cond) return cond.any.some((c) => evaluate(c, data));
  if ("not" in cond) return !evaluate(cond.not, data);
  const v = getPath(data, cond.field);
  switch (cond.op) {
    case "eq": return v === cond.value;
    case "neq": return v !== cond.value;
    case "gt": return Number(v) > Number(cond.value);
    case "gte": return Number(v) >= Number(cond.value);
    case "lt": return Number(v) < Number(cond.value);
    case "lte": return Number(v) <= Number(cond.value);
    case "in": return Array.isArray(cond.value) && cond.value.includes(v);
    case "truthy": return !!v;
    case "falsy": return !v;
  }
}

export interface FieldError { path: string; message: string }

/** Server-side validation of the dynamic form (the app runs the same rules client-side). */
export function validateFields(fields: TemplateField[], values: Record<string, any>, root: unknown, prefix: string): FieldError[] {
  const errors: FieldError[] = [];
  for (const f of fields) {
    if (!evaluate(f.showIf, root)) continue;
    const path = `${prefix}${f.id}`;
    const v = values?.[f.id];
    const empty = v === undefined || v === null || v === "";
    if (empty) {
      if (f.required) errors.push({ path, message: `${f.label} is required` });
      continue;
    }
    const val = f.validation ?? {};
    const msg = (fallback: string) => val.message ?? fallback;
    if (["number", "money", "percent"].includes(f.type)) {
      if (typeof v !== "number" || !Number.isFinite(v)) { errors.push({ path, message: `${f.label} must be a number` }); continue; }
      if (f.type === "money" && !Number.isInteger(v)) errors.push({ path, message: `${f.label} must be in whole paise` });
      if (val.min !== undefined && v < val.min) errors.push({ path, message: msg(`${f.label} must be at least ${val.min}`) });
      if (val.max !== undefined && v > val.max) errors.push({ path, message: msg(`${f.label} must be at most ${val.max}`) });
    } else if (f.type === "repeater") {
      if (!Array.isArray(v)) errors.push({ path, message: `${f.label} must be a list` });
      else v.forEach((item, i) => errors.push(...validateFields(f.itemFields ?? [], item, root, `${path}.${i}.`)));
    } else if (typeof v === "string") {
      const builtIn: Record<string, RegExp> = {
        phone: /^\+91[6-9]\d{9}$/, pincode: /^[1-9]\d{5}$/, pan: /^[A-Z]{5}\d{4}[A-Z]$/,
        aadhaarLast4: /^\d{4}$/, email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, date: /^\d{4}-\d{2}-\d{2}$/,
      };
      const re = val.pattern ? new RegExp(val.pattern) : builtIn[f.type];
      if (re && !re.test(v)) errors.push({ path, message: msg(`${f.label} is not valid`) });
      if (val.minLength !== undefined && v.length < val.minLength) errors.push({ path, message: msg(`${f.label} is too short`) });
      if (val.maxLength !== undefined && v.length > val.maxLength) errors.push({ path, message: msg(`${f.label} is too long`) });
      if (f.options && !f.options.some((o) => o.value === v)) errors.push({ path, message: `${f.label}: choose one of the options` });
    }
  }
  return errors;
}

export function validateForm(t: DocumentTemplate, form: Record<string, any>): FieldError[] {
  return t.sections.flatMap((s) => (evaluate(s.showIf, form) ? validateFields(s.fields, form[s.id] ?? {}, form, `${s.id}.`) : []));
}

/** Fill defaults so optional numeric fields (e.g. lockInMonths) are defined. */
export function withDefaults(t: DocumentTemplate, form: Record<string, any>) {
  const out: Record<string, any> = structuredClone(form);
  for (const s of t.sections) {
    out[s.id] ??= {};
    for (const f of s.fields) if (out[s.id][f.id] === undefined && f.default !== undefined) out[s.id][f.id] = f.default;
  }
  return out;
}
