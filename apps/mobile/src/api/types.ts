// Types for the LegalKart HTTP API (apps/api), written by hand to mirror its
// contract. They will move to `packages/shared` (with zod schemas) later so the
// app and the API cannot drift; until then keep them in sync manually.

export type DocumentStatus = "DRAFT" | "AWAITING_VERIFICATION" | "READY_TO_STAMP" | "GENERATED";
export type PartyRole = "LANDLORD" | "TENANT" | "WITNESS";
export type OtpChannel = "SMS" | "WHATSAPP";
export type AreaType =
  | "ANY"
  | "URBAN"
  | "RURAL"
  | "METRO"
  | "MUNICIPAL_CORPORATION"
  | "MUNICIPAL_COUNCIL"
  | "PANCHAYAT";

/** Error body every failing endpoint returns. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ------------------------------------------------------------------ pincode

export interface SroCandidate {
  code: string;
  name: string;
  confidence: number;
  isPrimary: boolean;
}

export interface PincodeResolution {
  pincode: string;
  stateCode: string;
  stateName: string;
  postOffices: string[];
  districts: { id: number; name: string }[];
  areaType: AreaType;
  sroCandidates: SroCandidate[];
  autoSelectedSroCode: string | null;
  needsUserConfirmation: boolean;
}

// ----------------------------------------------------------------- template

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "money"
  | "date"
  | "select"
  | "radio"
  | "checkbox"
  | "phone"
  | "email"
  | "pincode"
  | "pan"
  | "aadhaarLast4"
  | "address"
  | "percent"
  | "repeater";

export interface FieldOption {
  value: string;
  label: string;
}

export interface ShowIf {
  field: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "truthy" | "falsy";
  value?: unknown;
}

export interface TemplateField {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  hint?: string;
  default?: unknown;
  options?: FieldOption[];
  showIf?: ShowIf;
  itemFields?: TemplateField[];
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    message?: string;
  };
}

export interface TemplateSection {
  id: string;
  title: string;
  showIf?: ShowIf;
  fields: TemplateField[];
}

export interface TemplatePartyRule {
  role: PartyRole;
  label: string;
  min: number;
  max: number;
  otpRequired?: boolean;
  fields?: TemplateField[];
}

export interface TemplateVerification {
  requiredRoles: PartyRole[];
  channels: OtpChannel[];
  otpLength: number;
  otpTtlSeconds: number;
  maxAttempts: number;
}

export interface RentAgreementTemplate {
  templateKey: string;
  version: string;
  title: string;
  sections: TemplateSection[];
  parties: TemplatePartyRule[];
  verification: TemplateVerification;
  disclaimer?: unknown;
  [key: string]: unknown;
}

/** Form values keyed by section id, then field id. Money is integer paise. */
export type FormData = Record<string, Record<string, unknown>>;

// ---------------------------------------------------------------- documents

export interface AgreementDocument {
  id: string;
  status: DocumentStatus;
  referenceNo: string;
  propertyPincode: string | null;
  stateCode: string | null;
  formData: FormData;
  certificateNo?: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface Party {
  id: string;
  documentId: string;
  role: PartyRole;
  sequence: number;
  fullName: string;
  phoneE164: string;
  details: Record<string, unknown>;
  otpRequired: boolean;
  isVerified: boolean;
  verifiedAt: string | null;
}

export interface CreateAgreementResponse {
  document: AgreementDocument;
  resolution: PincodeResolution;
}

export interface AgreementBundle {
  document: AgreementDocument;
  parties: Party[];
  stampDetails: StampDetails | null;
}

export interface FieldError {
  path: string;
  message: string;
}

export interface SaveFormResponse {
  errors: FieldError[];
}

export interface AddPartyInput {
  role: PartyRole;
  fullName: string;
  phoneE164: string;
  details?: Record<string, unknown>;
}

// ------------------------------------------------------------- verification

export interface OtpSent {
  verificationId: string;
  channel: OtpChannel;
  expiresAt: string;
  phoneMasked: string;
}

export interface OtpVerified {
  partyId: string;
  verifiedAt: string;
  channel: OtpChannel;
  pendingPartyIds: string[];
}

// -------------------------------------------------------------------- stamp

export interface StampLine {
  chargeType: string;
  amountPaise: number;
  explanation: string;
  articleRef: string | null;
  payableAt: "ESTAMP" | "SRO";
}

export interface StampDetails {
  stateCode: string;
  dutyPaise: number;
  lines: StampLine[];
  portal: { name: string; url: string; steps: string[] };
  fields: { key: string; label: string; value: string }[];
  disclaimer: string;
  quotedAt: string;
}

export interface CertificateResponse {
  certificateNo: string;
  needsRegeneration: boolean;
}

export type FileFormat = "pdf" | "docx";

export interface GenerateResponse {
  referenceNo: string;
  sha256: string;
  certificateNo: string | null;
  files: { pdf: string | null; docx: string };
}
