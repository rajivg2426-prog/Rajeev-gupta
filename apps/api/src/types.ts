// Domain types. Field names mirror db/schema.sql (snake_case → camelCase).
import type { Paise } from "./money.ts";

export type PartyRole =
  | "LANDLORD" | "TENANT" | "LICENSOR" | "LICENSEE" | "SELLER" | "BUYER" | "DONOR" | "DONEE"
  | "PRINCIPAL" | "ATTORNEY" | "DEPONENT" | "WITNESS" | "CO_OWNER" | "GUARANTOR";

export type AreaType = "ANY" | "URBAN" | "RURAL" | "METRO" | "MUNICIPAL_CORPORATION" | "MUNICIPAL_COUNCIL" | "PANCHAYAT";
export type ChargeType = "STAMP_DUTY" | "REGISTRATION_FEE" | "SURCHARGE" | "CESS" | "MUTATION_FEE" | "PROCESSING_FEE";
export type DutyBasis =
  | "FIXED" | "CONSIDERATION" | "MAX_CONSIDERATION_MARKET_VALUE" | "AVG_ANNUAL_RENT_PLUS_DEPOSIT"
  | "TOTAL_RENT_PLUS_DEPOSIT" | "MH_LEAVE_AND_LICENCE" | "SLAB";

export type VerificationChannel = "SMS" | "WHATSAPP" | "VOICE";
export type VerificationStatus = "PENDING" | "SENT" | "VERIFIED" | "FAILED" | "EXPIRED" | "LOCKED";

export type DocumentStatus =
  | "DRAFT" | "AWAITING_VERIFICATION" | "READY_FOR_PAYMENT" | "PAYMENT_PENDING" | "PAID"
  | "ESTAMP_PROCESSING" | "ESTAMP_ISSUED" | "GENERATED" | "CANCELLED" | "FAILED";

export type EStampStatus =
  | "INITIATED" | "SUBMITTED" | "ISSUED" | "FULFILMENT_PENDING" | "DELIVERED" | "FAILED"
  | "MANUAL_REVIEW" | "REFUND_REQUESTED" | "REFUNDED";
export type EStampFulfilment = "DIGITAL_SELF_PRINT" | "ACC_PRINT_COURIER" | "ACC_PICKUP" | "FRANKING";

export interface PincodeRow {
  pincode: string;
  officeName: string;
  districtId: number;
  districtName: string;
  districtLgdCode: number | null;
  stateCode: string;
  stateName: string;
  areaType: AreaType;
}

export interface SroRow {
  id: number;
  code: string;
  name: string;
  districtId: number;
  address?: string;
}

export interface PincodeSroLink {
  pincode: string;
  sroId: number;
  isPrimary: boolean;
  confidence: number;
}

export interface StampRate {
  id: number;
  stateCode: string;
  districtId: number | null;
  areaType: AreaType;
  documentType: string;
  chargeType: ChargeType;
  articleRef: string | null;
  basis: DutyBasis;
  rateBps: number | null;
  fixedAmountPaise: Paise | null;
  minAmountPaise: Paise | null;
  maxAmountPaise: Paise | null;
  slabs: { uptoPaise: Paise | null; rateBps: number }[] | null;
  conditions: Record<string, unknown>;
  roundingUnitPaise: Paise;
  priority: number;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null;
  sourceRef: string;
  verifiedAt: string | null;
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
  verifiedAt: Date | null;
}

export interface PartyVerification {
  id: string;
  partyId: string;
  documentId: string;
  phoneE164: string;
  channel: VerificationChannel;
  status: VerificationStatus;
  otpHmac: string;
  attempts: number;
  maxAttempts: number;
  resendCount: number;
  provider: string;
  providerMessageId: string | null;
  expiresAt: Date;
  verifiedAt: Date | null;
  consentTextVersion: string;
  createdAt: Date;
}

export interface DocumentRecord {
  id: string;
  ownerUserId: string;
  templateKey: string;
  templateVersion: string;
  documentType: string;
  status: DocumentStatus;
  referenceNo: string;
  propertyPincode: string | null;
  stateCode: string | null;
  districtId: number | null;
  sroId: number | null;
  areaType: AreaType | null;
  pincodeData: PincodeData | null;
  formData: Record<string, any>;
  dutyQuote: DutyQuote | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PincodeData {
  pincode: string;
  postOffice?: string;
  stateCode: string;
  stateName: string;
  district: string;
  districtLgdCode: number | null;
  areaType: AreaType;
  sro: { code: string; name: string; address?: string } | null;
  resolution: { confidence: number; userConfirmed: boolean; candidates: number };
}

export interface DutyLine {
  chargeType: ChargeType;
  amountPaise: Paise;
  basis: DutyBasis;
  baseAmountPaise: Paise;
  rateBps: number | null;
  rateId: number;
  articleRef: string | null;
  explanation: string;
  payableAt: "ESTAMP" | "SRO";
}

export interface DutyQuote {
  stateCode: string;
  lines: DutyLine[];
  totalGovtPaise: Paise;
  estampAmountPaise: Paise;
  quoteHash: string;
  quotedAt: string;
  verifiedRates: boolean;
}

export interface Payment {
  id: string;
  documentId: string;
  gateway: "RAZORPAY";
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  status: "CREATED" | "CAPTURED" | "FAILED" | "REFUND_PENDING" | "REFUNDED";
  amountPaise: Paise;
  govtDutyPaise: Paise;
  vendorFeePaise: Paise;
  serviceFeePaise: Paise;
  gstPaise: Paise;
  dutyQuoteHash: string;
}

export interface EStampTransaction {
  id: string;
  documentId: string;
  paymentId: string;
  idempotencyKey: string;
  provider: string;
  providerRequestId: string | null;
  status: EStampStatus;
  fulfilmentMode: EStampFulfilment;
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
  certificateNo: string | null;
  uniqueDocReference: string | null;
  issuedAt: Date | null;
  accCode: string | null;
  certificatePdf: Uint8Array | null;
  verificationUrl: string | null;
  failureReason: string | null;
  attemptCount: number;
}
