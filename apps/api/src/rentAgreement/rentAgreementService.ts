// Rent Agreement flow, end to end:
//   draft (pincode → jurisdiction) → form → parties → tenant OTP verification
//   → stamp details (what to buy on the government portal) → optional
//   certificate number → agreement PDF + DOCX.
// Each step checks the document status, so the API cannot be called out of order.
// LegalKart takes no payment and buys no stamp (docs/SYSTEM-DESIGN.md).
import { randomUUID } from "node:crypto";
import { assemblePdf, htmlToPdf, toDocx, toHtml } from "../documents/output.ts";
import { renderDocument, type RenderStamp } from "../documents/render.ts";
import { getPath, validateForm, withDefaults, type DocumentTemplate, type FieldError } from "../documents/template.ts";
import { buildStampDetails, normaliseCertificateNo } from "../estamp/handoff.ts";
import { OtpService } from "../otp/otpService.ts";
import { PincodeService } from "../pincode/pincodeService.ts";
import { quoteDuty, type DutyInputs } from "../stamp/dutyEngine.ts";
import type { MemoryStore } from "../store.ts";
import type { DocumentRecord, DocumentStatus, Party, PartyRole, VerificationChannel } from "../types.ts";

export class FlowError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export interface FlowConfig {
  requireVerifiedRates: boolean;
  verifyBaseUrl: string;
}

/** Statuses in which the agreement's content can still change. */
const EDITABLE: DocumentStatus[] = ["DRAFT", "AWAITING_VERIFICATION", "READY_TO_STAMP"];

export class RentAgreementService {
  constructor(
    private store: MemoryStore,
    private template: DocumentTemplate,
    private pincodes: PincodeService,
    private otp: OtpService,
    private cfg: FlowConfig,
  ) {}

  // ---------------------------------------------------------------- helpers
  private doc(id: string) {
    const d = this.store.documents.get(id);
    if (!d) throw new FlowError("NOT_FOUND", "Document not found");
    return d;
  }
  private expect(d: DocumentRecord, allowed: DocumentStatus[]) {
    if (!allowed.includes(d.status)) throw new FlowError("INVALID_STATE", `Not allowed while document is ${d.status}`);
  }
  private touch(d: DocumentRecord, status?: DocumentStatus) {
    if (status) d.status = status;
    d.updatedAt = new Date();
  }
  /** Any edit after the stamp details were shown clears them (and any certificate bought against them). */
  private invalidateStampDetails(d: DocumentRecord) {
    d.dutyQuote = null;
    d.stampDetails = null;
    d.certificateNo = null;
    d.certificateAddedAt = null;
    if (d.status === "READY_TO_STAMP") d.status = "DRAFT";
  }

  // ---------------------------------------------------------- 1. location
  async createDraft(ownerUserId: string, input: { pincode: string; sroCode?: string }) {
    const res = await this.pincodes.resolve(input.pincode, { allowedStates: this.template.jurisdiction.states });
    // If res.needsUserConfirmation, the draft is still created and the app shows
    // the SRO picker (confirmSro) before the form.
    const confirmed = !!input.sroCode;
    const pincodeData = await this.pincodes.toPincodeData(res, input.sroCode ?? null, confirmed);
    const district = res.districts.find((x) => x.name === pincodeData.district)!;
    const now = new Date();
    const d: DocumentRecord = {
      id: randomUUID(),
      ownerUserId,
      templateKey: this.template.templateKey,
      templateVersion: this.template.version,
      documentType: this.template.documentType,
      status: "DRAFT",
      referenceNo: this.store.nextReferenceNo(),
      propertyPincode: input.pincode,
      stateCode: res.stateCode,
      districtId: district.id,
      sroId: null,
      areaType: res.areaType,
      pincodeData,
      formData: { property: { pincode: input.pincode } },
      dutyQuote: null,
      stampDetails: null,
      disclaimerAcceptedAt: null,
      certificateNo: null,
      certificateAddedAt: null,
      needsRegeneration: false,
      createdAt: now,
      updatedAt: now,
    };
    this.store.documents.set(d.id, d);
    this.store.log(`user:${ownerUserId}`, "DOCUMENT_CREATED", d.id, { pincode: input.pincode, state: res.stateCode });
    return { document: d, resolution: res };
  }

  async confirmSro(documentId: string, sroCode: string) {
    const d = this.doc(documentId);
    this.expect(d, EDITABLE);
    const res = await this.pincodes.resolve(d.propertyPincode!);
    d.pincodeData = await this.pincodes.toPincodeData(res, sroCode, true);
    this.invalidateStampDetails(d);
    this.touch(d);
    return d.pincodeData;
  }

  // -------------------------------------------------------------- 2. form
  async saveForm(documentId: string, form: Record<string, any>): Promise<{ errors: FieldError[] }> {
    const d = this.doc(documentId);
    this.expect(d, EDITABLE);
    const merged = withDefaults(this.template, { ...form, property: { ...form.property, pincode: d.propertyPincode } });
    d.formData = merged;
    this.invalidateStampDetails(d);
    this.touch(d);
    return { errors: validateForm(this.template, merged) };
  }

  // ----------------------------------------------------------- 3. parties
  async addParty(documentId: string, input: { role: PartyRole; fullName: string; phoneE164: string; details?: Record<string, unknown> }) {
    const d = this.doc(documentId);
    this.expect(d, EDITABLE);
    const rule = this.template.parties.find((p) => p.role === input.role);
    if (!rule) throw new FlowError("ROLE_NOT_ALLOWED", `${input.role} is not a party to this document`);
    if (!/^\+91[6-9]\d{9}$/.test(input.phoneE164)) throw new FlowError("INVALID_PHONE", "Enter a valid Indian mobile number");
    const existing = (await this.store.partiesOf(documentId)).filter((p) => p.role === input.role);
    if (existing.length >= rule.max) throw new FlowError("TOO_MANY_PARTIES", `At most ${rule.max} ${rule.label}(s)`);

    const party: Party = {
      id: randomUUID(),
      documentId,
      role: input.role,
      sequence: existing.length + 1,
      fullName: input.fullName.trim(),
      phoneE164: input.phoneE164,
      details: input.details ?? {},
      otpRequired: this.template.verification.requiredRoles.includes(input.role),
      isVerified: false,
      verifiedAt: null,
    };
    this.store.parties.set(party.id, party);
    this.invalidateStampDetails(d);
    this.touch(d, party.otpRequired ? "AWAITING_VERIFICATION" : d.status);
    return party;
  }

  async updatePartyPhone(documentId: string, partyId: string, phoneE164: string) {
    const d = this.doc(documentId);
    this.expect(d, EDITABLE);
    const party = this.store.parties.get(partyId);
    if (!party || party.documentId !== documentId) throw new FlowError("NOT_FOUND", "Party not found");
    if (party.phoneE164 !== phoneE164) {
      party.phoneE164 = phoneE164;
      party.isVerified = false; // a new number must be re-verified
      party.verifiedAt = null;
      this.invalidateStampDetails(d);
      this.touch(d, party.otpRequired ? "AWAITING_VERIFICATION" : d.status);
    }
    return party;
  }

  // ------------------------------------------------------ 4. verification
  async sendPartyOtp(documentId: string, partyId: string, channel: VerificationChannel) {
    const d = this.doc(documentId);
    this.expect(d, EDITABLE);
    if (!this.template.verification.channels.includes(channel)) throw new FlowError("CHANNEL_NOT_ALLOWED", `${channel} not enabled`);
    const party = this.store.parties.get(partyId);
    if (!party || party.documentId !== documentId) throw new FlowError("NOT_FOUND", "Party not found");
    return this.otp.start(party, channel, {
      documentLabel: this.template.title,
      consentTextVersion: this.template.verification.consentTextVersion ?? "v1",
    });
  }

  async verifyPartyOtp(documentId: string, verificationId: string, code: string) {
    const d = this.doc(documentId);
    const v = this.store.verifications.get(verificationId);
    if (!v || v.documentId !== documentId) throw new FlowError("NOT_FOUND", "Verification not found");
    const result = await this.otp.verify(verificationId, code);
    const pending = await this.pendingVerifications(documentId);
    if (pending.length === 0 && d.status === "AWAITING_VERIFICATION") this.touch(d, "DRAFT");
    return { ...result, pendingPartyIds: pending.map((p) => p.id) };
  }

  async pendingVerifications(documentId: string) {
    return (await this.store.partiesOf(documentId)).filter((p) => p.otpRequired && !p.isVerified);
  }

  // ------------------------------------------------ 5. stamp details
  private dutyInputs(form: Record<string, any>): DutyInputs {
    const inputs: Record<string, unknown> = {};
    for (const [k, path] of Object.entries(this.template.stampDuty.inputs)) inputs[k] = getPath(form, path);
    return inputs as DutyInputs;
  }

  /** Calculates the duty and what to enter on the government portal. Moves the document to READY_TO_STAMP. */
  async createStampDetails(documentId: string, input: { acceptDisclaimer: boolean }) {
    const d = this.doc(documentId);
    this.expect(d, EDITABLE);

    const errors = validateForm(this.template, d.formData);
    if (errors.length) throw new FlowError("FORM_INCOMPLETE", "Please complete the form", errors);
    const parties = await this.store.partiesOf(documentId);
    for (const rule of this.template.parties) {
      const n = parties.filter((p) => p.role === rule.role).length;
      if (n < rule.min) throw new FlowError("PARTY_MISSING", `Add at least ${rule.min} ${rule.label}`);
    }
    const pending = parties.filter((p) => p.otpRequired && !p.isVerified);
    if (pending.length && this.template.verification.blockGenerationUntilVerified) {
      this.touch(d, "AWAITING_VERIFICATION");
      throw new FlowError("VERIFICATION_PENDING", "All tenants must verify their mobile number by OTP", pending.map((p) => ({ partyId: p.id, name: p.fullName })));
    }
    if (this.template.disclaimer.requireAcknowledgement && !input.acceptDisclaimer) {
      throw new FlowError("DISCLAIMER_REQUIRED", "Please read and accept the disclaimer");
    }

    const rows = await this.store.findStampRates(d.stateCode!, d.documentType);
    d.dutyQuote = quoteDuty(rows, {
      stateCode: d.stateCode!,
      districtId: d.districtId,
      areaType: d.areaType ?? "ANY",
      documentType: d.documentType,
      onDate: d.formData.terms?.startDate ?? new Date().toISOString().slice(0, 10),
      requireVerifiedRates: this.cfg.requireVerifiedRates,
    }, this.dutyInputs(d.formData));
    d.stampDetails = buildStampDetails({
      template: this.template,
      pincodeData: d.pincodeData!,
      propertyAddress: String(d.formData.property?.address ?? ""),
      parties,
      quote: d.dutyQuote,
    });
    d.disclaimerAcceptedAt = new Date();
    this.touch(d, "READY_TO_STAMP");
    this.store.log("system", "STAMP_DETAILS_SHOWN", d.id, { dutyPaise: d.stampDetails.dutyPaise, quoteHash: d.dutyQuote.quoteHash });
    return d.stampDetails;
  }

  async getStampDetails(documentId: string) {
    const d = this.doc(documentId);
    if (!d.stampDetails) throw new FlowError("NOT_FOUND", "Stamp details have not been calculated yet");
    return d.stampDetails;
  }

  // -------------------------------------------------- 6. certificate
  /** Records the certificate number the customer bought on the portal. Format check only. */
  async setCertificate(documentId: string, raw: string) {
    const d = this.doc(documentId);
    this.expect(d, ["READY_TO_STAMP", "GENERATED"]);
    const certificateNo = normaliseCertificateNo(d.stateCode!, raw);
    if (await this.store.documentWithCertificate(d.stateCode!, certificateNo, d.id)) {
      throw new FlowError("CERTIFICATE_IN_USE", "This certificate number is already used on another agreement");
    }
    if (certificateNo !== d.certificateNo) {
      d.certificateNo = certificateNo;
      d.certificateAddedAt = new Date();
      if (d.status === "GENERATED") d.needsRegeneration = true;
      this.touch(d);
      this.store.log("system", "CERTIFICATE_ADDED", d.id, { certificateNo });
    }
    return { certificateNo, needsRegeneration: d.needsRegeneration };
  }

  // ----------------------------------------------------------- views
  partyView(p: Party) {
    return {
      // The owner entered these numbers, so the owner sees them in full.
      id: p.id, role: p.role, sequence: p.sequence, fullName: p.fullName, phoneE164: p.phoneE164,
      phoneMasked: `+91******${p.phoneE164.slice(-4)}`, details: p.details, otpRequired: p.otpRequired,
      isVerified: p.isVerified, verifiedAt: p.verifiedAt?.toISOString() ?? null,
    };
  }

  documentView(d: DocumentRecord) {
    return {
      id: d.id, referenceNo: d.referenceNo, status: d.status, propertyPincode: d.propertyPincode, stateCode: d.stateCode,
      pincodeData: d.pincodeData, formData: d.formData,
      certificateNo: d.certificateNo, needsRegeneration: d.needsRegeneration,
      createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
    };
  }

  async getDocument(documentId: string) {
    const d = this.doc(documentId);
    const parties = await this.store.partiesOf(documentId);
    return { document: this.documentView(d), parties: parties.map((p) => this.partyView(p)), stampDetails: d.stampDetails };
  }

  private renderStamp(d: DocumentRecord, parties: Party[]): RenderStamp | null {
    if (!d.stampDetails) return null;
    const by = (role: PartyRole) => parties.filter((p) => p.role === role).map((p) => p.fullName).join(", ");
    const e = this.template.eStamp;
    return {
      certificateNo: d.certificateNo,
      stampDutyPaise: d.stampDetails.dutyPaise,
      dutyPaidBy: by(e.dutyPaidByRole),
      firstParty: by(e.firstPartyRole),
      secondParty: by(e.secondPartyRole),
    };
  }

  /** Document instance snapshot — conforms to packages/templates/schemas/document-instance.schema.json. */
  async snapshot(documentId: string, outputSha256?: string) {
    const d = this.doc(documentId);
    const parties = await this.store.partiesOf(documentId);
    const verifications = [...this.store.verifications.values()];
    const pending = parties.filter((p) => p.otpRequired && !p.isVerified);
    const iso = (x: Date | null | undefined) => x?.toISOString();
    return {
      documentId: d.id,
      referenceNo: d.referenceNo,
      template: { templateKey: d.templateKey, version: d.templateVersion },
      status: d.status,
      form: d.formData,
      parties: parties.map((p) => {
        const v = verifications.find((x) => x.partyId === p.id && x.status === "VERIFIED");
        const det = p.details as Record<string, any>;
        return {
          partyId: p.id, role: p.role, sequence: p.sequence, fullName: p.fullName,
          ...(det.relation && { relation: det.relation }), ...(det.relationName && { relationName: det.relationName }),
          ...(det.age && { age: det.age }), ...(det.address && { address: det.address }),
          phoneMasked: `+91******${p.phoneE164.slice(-4)}`,
          verification: p.isVerified && v
            ? { required: p.otpRequired, status: "VERIFIED", channel: v.channel, verifiedAt: iso(p.verifiedAt), verificationId: v.id, consentTextVersion: v.consentTextVersion }
            : { required: p.otpRequired, status: p.otpRequired ? "PENDING" : "NOT_REQUIRED" },
        };
      }),
      pincodeData: d.pincodeData,
      dutyQuote: d.dutyQuote,
      verification: {
        allRequiredVerified: pending.length === 0,
        requiredRoles: this.template.verification.requiredRoles,
        pendingPartyIds: pending.map((p) => p.id),
      },
      eStamp: d.stampDetails && {
        portal: d.stampDetails.portal.name,
        stampDutyPaise: d.stampDetails.dutyPaise,
        ...(d.certificateNo && { certificateNo: d.certificateNo, certificateAddedAt: iso(d.certificateAddedAt) }),
      },
      generatedAt: d.status === "GENERATED" ? iso(d.updatedAt) : null,
      ...(outputSha256 && { outputSha256 }),
    };
  }

  // ------------------------------------------------------------ 7. output
  private async channelOf(partyId: string) {
    return [...this.store.verifications.values()].find((v) => v.partyId === partyId && v.status === "VERIFIED")?.channel;
  }

  /** Watermarked draft — allowed at any point before generation. */
  async previewHtml(documentId: string) {
    const d = this.doc(documentId);
    const parties = await this.store.partiesOf(documentId);
    const model = renderDocument({
      template: this.template, referenceNo: d.referenceNo, form: d.formData, parties,
      pincodeData: d.pincodeData!, dutyQuote: d.dutyQuote, stamp: this.renderStamp(d, parties), final: false, executionDate: new Date(),
    });
    return toHtml(model, this.template.output.pageSize);
  }

  /** Final agreement. Works with or without a certificate number; regenerates after one is added. */
  async generate(documentId: string, opts: { pdf?: boolean } = { pdf: true }) {
    const d = this.doc(documentId);
    this.expect(d, ["READY_TO_STAMP", "GENERATED"]);
    const parties = await this.store.partiesOf(documentId);
    const pending = parties.filter((p) => p.otpRequired && !p.isVerified);
    if (pending.length) throw new FlowError("VERIFICATION_PENDING", "Party verification was reset; re-verify before generating");

    const channels = new Map<string, string | undefined>();
    for (const p of parties) channels.set(p.id, await this.channelOf(p.id));
    const model = renderDocument({
      template: this.template, referenceNo: d.referenceNo, form: d.formData, parties,
      pincodeData: d.pincodeData!, dutyQuote: d.dutyQuote, stamp: this.renderStamp(d, parties), final: true, executionDate: new Date(),
    }, (id) => channels.get(id));

    const html = toHtml(model, this.template.output.pageSize);
    const docx = await toDocx(model);
    let pdf: { pdf: Uint8Array; sha256: string } | null = null;
    if (opts.pdf) {
      pdf = await assemblePdf(await htmlToPdf(html), model, { verifyUrl: `${this.cfg.verifyBaseUrl}/${d.referenceNo}` });
    }
    d.needsRegeneration = false;
    this.touch(d, "GENERATED");
    this.store.log("system", "DOCUMENT_GENERATED", d.id, { certificateNo: d.certificateNo, sha256: pdf?.sha256 });
    return { html, docx, pdf, model };
  }
}
