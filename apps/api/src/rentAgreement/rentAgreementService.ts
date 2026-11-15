// Rent Agreement flow, end to end:
//   draft (pincode → jurisdiction) → form → parties → tenant OTP verification
//   → duty quote → Razorpay payment → e-stamp purchase → stamped PDF + DOCX.
// Each step checks the document state, so the API cannot be called out of order.
import { randomUUID } from "node:crypto";
import { EStampService, hasCertificate } from "../estamp/estampService.ts";
import type { EStampRequest } from "../estamp/provider.ts";
import { assembleStampedPdf, htmlToPdf, toDocx, toHtml } from "../documents/output.ts";
import { renderDocument } from "../documents/render.ts";
import { getPath, validateForm, withDefaults, type DocumentTemplate, type FieldError } from "../documents/template.ts";
import type { Paise } from "../money.ts";
import { OtpService } from "../otp/otpService.ts";
import { priceOrder, type PaymentGateway } from "../payments/razorpay.ts";
import { PincodeService } from "../pincode/pincodeService.ts";
import { quoteDuty, type DutyInputs } from "../stamp/dutyEngine.ts";
import type { MemoryStore } from "../store.ts";
import type { DocumentRecord, DocumentStatus, EStampFulfilment, Party, PartyRole, VerificationChannel } from "../types.ts";

export class FlowError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export interface FlowConfig {
  serviceFeePaise: Paise;
  vendorFeePaise: Paise;
  requireVerifiedRates: boolean;
  verifyBaseUrl: string;
}

export class RentAgreementService {
  constructor(
    private store: MemoryStore,
    private template: DocumentTemplate,
    private pincodes: PincodeService,
    private otp: OtpService,
    private estamp: EStampService,
    private gateway: PaymentGateway,
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
  /** Any edit after quoting invalidates the quote. */
  private invalidateQuote(d: DocumentRecord) {
    d.dutyQuote = null;
    if (d.status === "READY_FOR_PAYMENT") d.status = "DRAFT";
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
      createdAt: now,
      updatedAt: now,
    };
    this.store.documents.set(d.id, d);
    this.store.log(`user:${ownerUserId}`, "DOCUMENT_CREATED", d.id, { pincode: input.pincode, state: res.stateCode });
    return { document: d, resolution: res };
  }

  async confirmSro(documentId: string, sroCode: string) {
    const d = this.doc(documentId);
    this.expect(d, ["DRAFT", "AWAITING_VERIFICATION", "READY_FOR_PAYMENT"]);
    const res = await this.pincodes.resolve(d.propertyPincode!);
    d.pincodeData = await this.pincodes.toPincodeData(res, sroCode, true);
    this.invalidateQuote(d);
    this.touch(d);
    return d.pincodeData;
  }

  // -------------------------------------------------------------- 2. form
  async saveForm(documentId: string, form: Record<string, any>): Promise<{ errors: FieldError[] }> {
    const d = this.doc(documentId);
    this.expect(d, ["DRAFT", "AWAITING_VERIFICATION", "READY_FOR_PAYMENT"]);
    const merged = withDefaults(this.template, { ...form, property: { ...form.property, pincode: d.propertyPincode } });
    d.formData = merged;
    this.invalidateQuote(d);
    this.touch(d);
    return { errors: validateForm(this.template, merged) };
  }

  // ----------------------------------------------------------- 3. parties
  async addParty(documentId: string, input: { role: PartyRole; fullName: string; phoneE164: string; details?: Record<string, unknown> }) {
    const d = this.doc(documentId);
    this.expect(d, ["DRAFT", "AWAITING_VERIFICATION", "READY_FOR_PAYMENT"]);
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
    this.invalidateQuote(d);
    this.touch(d, party.otpRequired ? "AWAITING_VERIFICATION" : d.status);
    return party;
  }

  async updatePartyPhone(documentId: string, partyId: string, phoneE164: string) {
    const d = this.doc(documentId);
    this.expect(d, ["DRAFT", "AWAITING_VERIFICATION", "READY_FOR_PAYMENT"]);
    const party = this.store.parties.get(partyId);
    if (!party || party.documentId !== documentId) throw new FlowError("NOT_FOUND", "Party not found");
    if (party.phoneE164 !== phoneE164) {
      party.phoneE164 = phoneE164;
      party.isVerified = false; // a new number must be re-verified
      party.verifiedAt = null;
      this.invalidateQuote(d);
      this.touch(d, party.otpRequired ? "AWAITING_VERIFICATION" : d.status);
    }
    return party;
  }

  // ------------------------------------------------------ 4. verification
  async sendPartyOtp(documentId: string, partyId: string, channel: VerificationChannel) {
    const d = this.doc(documentId);
    this.expect(d, ["DRAFT", "AWAITING_VERIFICATION", "READY_FOR_PAYMENT"]);
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

  // ------------------------------------------------------------ 5. quote
  private dutyInputs(form: Record<string, any>): DutyInputs {
    const inputs: Record<string, unknown> = {};
    for (const [k, path] of Object.entries(this.template.stampDuty.inputs)) inputs[k] = getPath(form, path);
    return inputs as DutyInputs;
  }

  async quote(documentId: string) {
    const d = this.doc(documentId);
    this.expect(d, ["DRAFT", "AWAITING_VERIFICATION", "READY_FOR_PAYMENT"]);

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

    const rows = await this.store.findStampRates(d.stateCode!, d.documentType);
    d.dutyQuote = quoteDuty(rows, {
      stateCode: d.stateCode!,
      districtId: d.districtId,
      areaType: d.areaType ?? "ANY",
      documentType: d.documentType,
      onDate: d.formData.terms?.startDate ?? new Date().toISOString().slice(0, 10),
      requireVerifiedRates: this.cfg.requireVerifiedRates,
    }, this.dutyInputs(d.formData));
    this.touch(d, "READY_FOR_PAYMENT");
    const price = priceOrder(d.dutyQuote.estampAmountPaise, this.cfg);
    return { quote: d.dutyQuote, price };
  }

  // ---------------------------------------------------------- 6. payment
  async createPayment(documentId: string) {
    const d = this.doc(documentId);
    this.expect(d, ["READY_FOR_PAYMENT", "PAYMENT_PENDING"]);
    const q = d.dutyQuote!;
    const price = priceOrder(q.estampAmountPaise, this.cfg);
    const { orderId } = await this.gateway.createOrder({
      amountPaise: price.totalPaise,
      receipt: d.referenceNo,
      notes: { documentId, quoteHash: q.quoteHash },
    });
    const payment = {
      id: randomUUID(),
      documentId,
      gateway: "RAZORPAY" as const,
      gatewayOrderId: orderId,
      gatewayPaymentId: null,
      status: "CREATED" as const,
      amountPaise: price.totalPaise,
      govtDutyPaise: price.govtDutyPaise,
      vendorFeePaise: price.vendorFeePaise,
      serviceFeePaise: price.serviceFeePaise,
      gstPaise: price.gstPaise,
      dutyQuoteHash: q.quoteHash,
    };
    this.store.payments.set(payment.id, payment);
    this.touch(d, "PAYMENT_PENDING");
    return { paymentId: payment.id, orderId, amountPaise: price.totalPaise, breakdown: price };
  }

  /** From the app after Razorpay Checkout succeeds. The webhook path converges on the same capture. */
  async confirmPayment(documentId: string, input: { orderId: string; paymentId: string; signature: string }) {
    if (!this.gateway.verifyCheckout(input)) throw new FlowError("BAD_SIGNATURE", "Payment signature mismatch");
    return this.capture(documentId, input.orderId, input.paymentId);
  }

  async handlePaymentWebhook(rawBody: string, signature: string) {
    if (!this.gateway.verifyWebhook(rawBody, signature)) throw new FlowError("BAD_SIGNATURE", "Invalid webhook signature");
    const event = JSON.parse(rawBody) as { event: string; payload: { payment?: { entity: { id: string; order_id: string } } } };
    const entity = event.payload.payment?.entity;
    if (!entity) return { ignored: true };
    const key = `RAZORPAY:${event.event}:${entity.id}`;
    if (this.store.webhookEvents.has(key)) return { duplicate: true };
    this.store.webhookEvents.add(key);
    if (event.event !== "payment.captured") return { ignored: true };
    const payment = await this.store.paymentByOrderId(entity.order_id);
    if (!payment) return { ignored: true };
    return this.capture(payment.documentId, entity.order_id, entity.id);
  }

  private async capture(documentId: string, orderId: string, gatewayPaymentId: string) {
    const d = this.doc(documentId);
    const payment = await this.store.paymentByOrderId(orderId);
    if (!payment || payment.documentId !== documentId) throw new FlowError("NOT_FOUND", "Payment not found");
    if (payment.status !== "CAPTURED") {
      payment.status = "CAPTURED";
      payment.gatewayPaymentId = gatewayPaymentId;
      this.touch(d, "PAID");
      this.store.log("system", "PAYMENT_CAPTURED", payment.id, { documentId, amountPaise: payment.amountPaise });
    }
    return payment;
  }

  // ----------------------------------------------------------- 7. e-stamp
  private partyNames(parties: Party[], role: PartyRole) {
    return parties.filter((p) => p.role === role).map((p) => p.fullName).join(", ");
  }

  async purchaseEStamp(documentId: string, fulfilmentMode: EStampFulfilment = "DIGITAL_SELF_PRINT") {
    const d = this.doc(documentId);
    this.expect(d, ["PAID", "ESTAMP_PROCESSING"]);
    if (!this.template.eStamp.fulfilmentModes.includes(fulfilmentMode)) throw new FlowError("MODE_NOT_ALLOWED", fulfilmentMode);
    const payment = [...this.store.payments.values()].find((p) => p.documentId === documentId && p.status === "CAPTURED");
    if (!payment) throw new FlowError("NOT_PAID", "No captured payment");

    const parties = await this.store.partiesOf(documentId);
    const e = this.template.eStamp;
    const pd = d.pincodeData!;
    const req: EStampRequest = {
      stateCode: pd.stateCode,
      articleCode: e.articleCodes[pd.stateCode] ?? e.articleCodes["*"]!,
      descriptionOfDocument: e.descriptionOfDocument,
      propertyDescription: `${d.formData.property?.address ?? ""} - ${pd.pincode}`,
      // Rent agreements carry no "consideration" in the sale sense; vendors expect 0.
      considerationPaise: 0,
      stampDutyPaise: d.dutyQuote!.estampAmountPaise,
      firstPartyName: this.partyNames(parties, e.firstPartyRole),
      secondPartyName: this.partyNames(parties, e.secondPartyRole),
      dutyPaidBy: this.partyNames(parties, e.dutyPaidByRole),
      purchasedBy: this.partyNames(parties, e.purchasedByRole ?? e.dutyPaidByRole),
      fulfilmentMode,
    };
    const tx = await this.estamp.purchase(documentId, payment.id, req);
    if (hasCertificate(tx)) this.touch(d, "ESTAMP_ISSUED");
    else if (tx.status === "FAILED") {
      payment.status = "REFUND_PENDING"; // refund job calls Razorpay Refunds API
      this.touch(d, "FAILED");
    } else this.touch(d, "ESTAMP_PROCESSING");
    return tx;
  }

  /** Document instance snapshot — conforms to schemas/document-instance.schema.json. */
  async snapshot(documentId: string, outputSha256?: string) {
    const d = this.doc(documentId);
    const parties = await this.store.partiesOf(documentId);
    const tx = await this.store.eStampForDocument(documentId);
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
      eStamp: tx && {
        transactionId: tx.id, status: tx.status, provider: tx.provider, fulfilmentMode: tx.fulfilmentMode,
        ...(tx.certificateNo && { certificateNo: tx.certificateNo }),
        ...(tx.uniqueDocReference && { uniqueDocReference: tx.uniqueDocReference }),
        ...(tx.issuedAt && { issuedAt: iso(tx.issuedAt) }), ...(tx.accCode && { accCode: tx.accCode }),
        articleCode: tx.articleCode, descriptionOfDocument: tx.descriptionOfDocument, propertyDescription: tx.propertyDescription,
        considerationPaise: tx.considerationPaise, stampDutyPaise: tx.stampDutyPaise,
        firstParty: tx.firstPartyName, secondParty: tx.secondPartyName, dutyPaidBy: tx.dutyPaidBy, purchasedBy: tx.purchasedBy,
        ...(tx.verificationUrl && { verificationUrl: tx.verificationUrl }),
      },
      generatedAt: d.status === "GENERATED" ? iso(d.updatedAt) : null,
      ...(outputSha256 && { outputSha256 }),
    };
  }

  // ------------------------------------------------------------ 8. output
  /** Unstamped, watermarked preview — allowed before payment. */
  async previewHtml(documentId: string) {
    const d = this.doc(documentId);
    const model = renderDocument({
      template: this.template, referenceNo: d.referenceNo, form: d.formData,
      parties: await this.store.partiesOf(documentId), pincodeData: d.pincodeData!,
      dutyQuote: d.dutyQuote, eStamp: null, executionDate: new Date(),
    });
    return toHtml(model, this.template.output.pageSize);
  }

  async generate(documentId: string, opts: { pdf?: boolean } = { pdf: true }) {
    const d = this.doc(documentId);
    this.expect(d, ["ESTAMP_ISSUED", "GENERATED"]);
    const tx = await this.store.eStampForDocument(documentId);
    if (!hasCertificate(tx)) throw new FlowError("NOT_STAMPED", "E-stamp certificate not yet issued");
    const parties = await this.store.partiesOf(documentId);
    const pending = parties.filter((p) => p.otpRequired && !p.isVerified);
    if (pending.length) throw new FlowError("VERIFICATION_PENDING", "Party verification was reset; re-verify before generating");

    const channelOf = (partyId: string) =>
      [...this.store.verifications.values()].find((v) => v.partyId === partyId && v.status === "VERIFIED")?.channel;
    const model = renderDocument({
      template: this.template, referenceNo: d.referenceNo, form: d.formData, parties,
      pincodeData: d.pincodeData!, dutyQuote: d.dutyQuote, eStamp: tx, executionDate: tx!.issuedAt ?? new Date(),
    }, channelOf);

    const html = toHtml(model, this.template.output.pageSize);
    const docx = await toDocx(model);
    let pdf: { pdf: Uint8Array; sha256: string } | null = null;
    if (opts.pdf) {
      pdf = await assembleStampedPdf(await htmlToPdf(html), model, {
        certificatePdf: tx!.certificatePdf,
        verifyUrl: `${this.cfg.verifyBaseUrl}/${d.referenceNo}`,
      });
    }
    this.touch(d, "GENERATED");
    this.store.log("system", "DOCUMENT_GENERATED", d.id, { certificateNo: tx!.certificateNo, sha256: pdf?.sha256 });
    return { html, docx, pdf, model };
  }
}
