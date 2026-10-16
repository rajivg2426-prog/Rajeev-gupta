// Orchestrates one e-stamp purchase per paid document, safely.
//
// Invariants:
//  * Only after payment CAPTURED and only for the exact frozen quote amount.
//  * One idempotency key per (document, payment): retries and webhook replays
//    can never buy a second stamp.
//  * An ambiguous vendor error (timeout after send) is NEVER retried with a new
//    key — it moves to SUBMITTED and is resolved by polling status, falling back
//    to MANUAL_REVIEW for ops.
//  * Definite failure → FAILED, and the caller triggers a refund of the duty.
import { randomUUID } from "node:crypto";
import type { MemoryStore } from "../store.ts";
import type { EStampTransaction } from "../types.ts";
import { EStampProviderError, type EStampProvider, type EStampRequest, type EStampResult } from "./provider.ts";

export const MAX_POLLS_BEFORE_MANUAL_REVIEW = 10;

export class EStampError extends Error {
  constructor(public code: "NO_PROVIDER" | "AMOUNT_MISMATCH" | "NOT_PAID" | "NOT_FOUND", message: string) {
    super(message);
  }
}

export class EStampService {
  constructor(private store: MemoryStore, private providers: EStampProvider[]) {}

  pickProvider(stateCode: string, mode: EStampRequest["fulfilmentMode"], preferred?: string) {
    const ordered = [
      ...this.providers.filter((x) => x.name === preferred),
      ...this.providers.filter((x) => x.name !== preferred),
    ];
    const p = ordered.find((x) => x.supports(stateCode, mode));
    if (!p) throw new EStampError("NO_PROVIDER", `No e-stamp route for ${stateCode} / ${mode}`);
    return p;
  }

  async purchase(documentId: string, paymentId: string, req: EStampRequest, preferredProvider?: string): Promise<EStampTransaction> {
    const payment = this.store.payments.get(paymentId);
    const doc = this.store.documents.get(documentId);
    if (!payment || payment.status !== "CAPTURED" || payment.documentId !== documentId) {
      throw new EStampError("NOT_PAID", "Payment not captured for this document");
    }
    if (!doc?.dutyQuote || doc.dutyQuote.quoteHash !== payment.dutyQuoteHash || req.stampDutyPaise !== doc.dutyQuote.estampAmountPaise) {
      throw new EStampError("AMOUNT_MISMATCH", "E-stamp amount does not match the paid quote");
    }

    const idempotencyKey = `estamp:${documentId}:${paymentId}`;
    const existing = [...this.store.eStamps.values()].find((t) => t.idempotencyKey === idempotencyKey);
    if (existing) return existing;

    const provider = this.pickProvider(req.stateCode, req.fulfilmentMode, preferredProvider);
    const tx: EStampTransaction = {
      id: randomUUID(),
      documentId,
      paymentId,
      idempotencyKey,
      provider: provider.name,
      providerRequestId: null,
      status: "INITIATED",
      fulfilmentMode: req.fulfilmentMode,
      stateCode: req.stateCode,
      articleCode: req.articleCode,
      descriptionOfDocument: req.descriptionOfDocument,
      propertyDescription: req.propertyDescription,
      considerationPaise: req.considerationPaise,
      stampDutyPaise: req.stampDutyPaise,
      firstPartyName: req.firstPartyName,
      secondPartyName: req.secondPartyName,
      dutyPaidBy: req.dutyPaidBy,
      purchasedBy: req.purchasedBy,
      certificateNo: null,
      uniqueDocReference: null,
      issuedAt: null,
      accCode: null,
      certificatePdf: null,
      verificationUrl: null,
      failureReason: null,
      attemptCount: 0,
    };
    this.store.eStamps.set(tx.id, tx);
    this.store.log("system", "ESTAMP_INITIATED", tx.id, { provider: provider.name, documentId });

    tx.attemptCount++;
    try {
      this.apply(tx, await provider.purchase(req, idempotencyKey));
    } catch (err) {
      if (err instanceof EStampProviderError && err.ambiguous) {
        tx.status = "SUBMITTED"; // resolve via status() polling, same key
        tx.failureReason = `ambiguous: ${err.message}`;
      } else {
        tx.status = "FAILED";
        tx.failureReason = String(err instanceof Error ? err.message : err);
      }
    }
    this.store.log("system", `ESTAMP_${tx.status}`, tx.id, { certificateNo: tx.certificateNo });
    return tx;
  }

  /** Called by the BullMQ poller for SUBMITTED / FULFILMENT_PENDING rows. */
  async poll(txId: string): Promise<EStampTransaction> {
    const tx = this.store.eStamps.get(txId);
    if (!tx) throw new EStampError("NOT_FOUND", "e-stamp transaction not found");
    if (tx.status !== "SUBMITTED") return tx;
    const provider = this.providers.find((p) => p.name === tx.provider)!;
    tx.attemptCount++;
    try {
      this.apply(tx, await provider.status({ providerRequestId: tx.providerRequestId ?? undefined, idempotencyKey: tx.idempotencyKey }));
    } catch (err) {
      tx.failureReason = String(err);
    }
    if (tx.status === "SUBMITTED" && tx.attemptCount >= MAX_POLLS_BEFORE_MANUAL_REVIEW) tx.status = "MANUAL_REVIEW";
    return tx;
  }

  /** Ops console: attach a certificate bought offline at an ACC. */
  async completeManually(txId: string, cert: { certificateNo: string; issuedAt: Date; accCode: string; certificatePdf: Uint8Array }, opsUser: string) {
    const tx = this.store.eStamps.get(txId);
    if (!tx) throw new EStampError("NOT_FOUND", "e-stamp transaction not found");
    Object.assign(tx, { ...cert, status: "ISSUED" });
    this.store.log(`ops:${opsUser}`, "ESTAMP_ISSUED_MANUAL", tx.id, { certificateNo: cert.certificateNo });
    return tx;
  }

  private apply(tx: EStampTransaction, r: EStampResult) {
    tx.status = r.status;
    tx.providerRequestId = r.providerRequestId ?? tx.providerRequestId;
    if (r.certificateNo) {
      tx.certificateNo = r.certificateNo;
      tx.uniqueDocReference = r.uniqueDocReference ?? null;
      tx.issuedAt = r.issuedAt ?? new Date();
      tx.accCode = r.accCode ?? null;
      tx.certificatePdf = r.certificatePdf ?? null;
      tx.verificationUrl = r.verificationUrl ?? null;
    }
    if (r.status === "FAILED") tx.failureReason = r.failureReason ?? "vendor rejected";
  }
}

/** A certificate number exists once the vendor has issued, even if courier is pending. */
export const hasCertificate = (tx: EStampTransaction | null) =>
  !!tx?.certificateNo && ["ISSUED", "FULFILMENT_PENDING", "DELIVERED"].includes(tx.status);
