// E-stamp vendor abstraction.
//
// Reality check for India (see docs §C.1): SHCIL (StockHolding Corporation of
// India) is the Central Record Keeping Agency for e-stamping in most states,
// but it does not publish an open self-serve purchase API. Integration happens
// through one of:
//   1. a registered Authorised Collection Centre (ACC) / business arrangement
//      with SHCIL that exposes a partner API,
//   2. a state treasury / GRAS portal (e.g. Maharashtra GRAS, Haryana e-GRAS),
//   3. a licensed aggregator (e.g. the "stamp2india"-type vendors in the brief),
//      under its own commercial contract, or
//   4. MANUAL_OPS: our ops team buys at an ACC and uploads the certificate.
// Every route is wrapped in this one interface so the app flow never changes.
import type { Paise } from "../money.ts";
import type { EStampFulfilment, EStampStatus } from "../types.ts";

export interface EStampRequest {
  stateCode: string;
  articleCode: string;
  descriptionOfDocument: string;
  propertyDescription: string;
  considerationPaise: Paise;
  stampDutyPaise: Paise;
  firstPartyName: string;
  secondPartyName: string;
  dutyPaidBy: string;
  purchasedBy: string;
  fulfilmentMode: EStampFulfilment;
  delivery?: { name: string; phoneE164: string; address: string; pincode: string };
}

export interface EStampResult {
  status: Extract<EStampStatus, "SUBMITTED" | "ISSUED" | "FULFILMENT_PENDING" | "FAILED">;
  providerRequestId?: string;
  certificateNo?: string;
  uniqueDocReference?: string;
  issuedAt?: Date;
  accCode?: string;
  certificatePdf?: Uint8Array;
  verificationUrl?: string;
  failureReason?: string;
  raw?: unknown;
}

export interface EStampProvider {
  readonly name: string;
  supports(stateCode: string, mode: EStampFulfilment): boolean;
  /** Must be idempotent on `idempotencyKey`: a retry returns the original purchase. */
  purchase(req: EStampRequest, idempotencyKey: string): Promise<EStampResult>;
  /** Look up by vendor id, or by our idempotency key after an ambiguous timeout. */
  status(ref: { providerRequestId?: string; idempotencyKey: string }): Promise<EStampResult>;
}

export class EStampProviderError extends Error {
  /** ambiguous = the vendor may or may not have debited/issued (timeouts, 5xx after send). */
  constructor(public provider: string, public ambiguous: boolean, message: string) {
    super(message);
  }
}
