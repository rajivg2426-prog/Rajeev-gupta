// In-memory store so the sample runs with zero infrastructure.
// Production swaps this for Postgres repositories over db/schema.sql; the
// interface is deliberately the same shape (async, one method per query).
import type {
  DocumentRecord, EStampTransaction, Party, PartyVerification, Payment, PincodeRow,
  PincodeSroLink, SroRow, StampRate,
} from "./types.ts";

export interface ReferenceData {
  pincodes: PincodeRow[];
  sros: SroRow[];
  pincodeSro: PincodeSroLink[];
  stampRates: StampRate[];
}

export class MemoryStore {
  documents = new Map<string, DocumentRecord>();
  parties = new Map<string, Party>();
  verifications = new Map<string, PartyVerification>();
  payments = new Map<string, Payment>();
  eStamps = new Map<string, EStampTransaction>();
  webhookEvents = new Set<string>();
  audit: { at: Date; actor: string; action: string; entityId: string; meta: unknown }[] = [];
  private refSeq = 0;

  constructor(public ref: ReferenceData) {}

  // --- reference data -------------------------------------------------------
  async findPincodeRows(pincode: string) {
    return this.ref.pincodes.filter((p) => p.pincode === pincode);
  }
  async findSrosForPincode(pincode: string) {
    return this.ref.pincodeSro
      .filter((l) => l.pincode === pincode)
      .map((l) => ({ link: l, sro: this.ref.sros.find((s) => s.id === l.sroId)! }))
      .sort((a, b) => b.link.confidence - a.link.confidence);
  }
  async findSroByCode(code: string) {
    return this.ref.sros.find((s) => s.code === code) ?? null;
  }
  async findStampRates(stateCode: string, documentType: string) {
    return this.ref.stampRates.filter((r) => r.stateCode === stateCode && r.documentType === documentType);
  }

  // --- documents & parties --------------------------------------------------
  nextReferenceNo(year = new Date().getFullYear()) {
    return `LK-${year}-${String(++this.refSeq).padStart(6, "0")}`;
  }
  async partiesOf(documentId: string) {
    return [...this.parties.values()]
      .filter((p) => p.documentId === documentId)
      .sort((a, b) => a.role.localeCompare(b.role) || a.sequence - b.sequence);
  }
  async liveVerificationFor(partyId: string) {
    return [...this.verifications.values()].find(
      (v) => v.partyId === partyId && (v.status === "PENDING" || v.status === "SENT"),
    ) ?? null;
  }
  async verificationsForPhoneSince(phoneE164: string, since: Date) {
    return [...this.verifications.values()].filter((v) => v.phoneE164 === phoneE164 && v.createdAt >= since);
  }
  async eStampForDocument(documentId: string) {
    return [...this.eStamps.values()].find((e) => e.documentId === documentId && e.status !== "FAILED") ?? null;
  }
  async paymentByOrderId(orderId: string) {
    return [...this.payments.values()].find((p) => p.gatewayOrderId === orderId) ?? null;
  }

  log(actor: string, action: string, entityId: string, meta: unknown = {}) {
    this.audit.push({ at: new Date(), actor, action, entityId, meta });
  }
}

/** Mirrors db/seed.sql. ILLUSTRATIVE RATES — see the warning in that file. */
export function sampleReferenceData(): ReferenceData {
  const base = {
    districtId: null, areaType: "ANY" as const, articleRef: null, rateBps: null, fixedAmountPaise: null,
    minAmountPaise: null, maxAmountPaise: null, slabs: null, conditions: {}, roundingUnitPaise: 100,
    priority: 0, effectiveFrom: "2024-04-01", effectiveTo: null, sourceRef: "ILLUSTRATIVE", verifiedAt: null,
  };
  return {
    pincodes: [
      { pincode: "110017", officeName: "Malviya Nagar S.O", districtId: 1, districtName: "South Delhi", districtLgdCode: null, stateCode: "DL", stateName: "Delhi", areaType: "METRO" },
      { pincode: "110017", officeName: "Saket S.O", districtId: 1, districtName: "South Delhi", districtLgdCode: null, stateCode: "DL", stateName: "Delhi", areaType: "METRO" },
      { pincode: "122001", officeName: "Gurgaon H.O", districtId: 2, districtName: "Gurugram", districtLgdCode: null, stateCode: "HR", stateName: "Haryana", areaType: "URBAN" },
      { pincode: "122001", officeName: "Sector 12 Gurgaon", districtId: 2, districtName: "Gurugram", districtLgdCode: null, stateCode: "HR", stateName: "Haryana", areaType: "URBAN" },
      { pincode: "560034", officeName: "Koramangala S.O", districtId: 3, districtName: "Bengaluru Urban", districtLgdCode: null, stateCode: "KA", stateName: "Karnataka", areaType: "URBAN" },
      { pincode: "400053", officeName: "Azad Nagar S.O", districtId: 4, districtName: "Mumbai Suburban", districtLgdCode: null, stateCode: "MH", stateName: "Maharashtra", areaType: "METRO" },
    ],
    sros: [
      { id: 1, code: "DL-SD-SR-V", name: "Sub-Registrar V, Mehrauli", districtId: 1 },
      { id: 2, code: "HR-GGN-WAZIRABAD", name: "Sub-Registrar Wazirabad, Gurugram", districtId: 2 },
      { id: 3, code: "HR-GGN-GURGAON", name: "Sub-Registrar Gurugram", districtId: 2 },
      { id: 4, code: "KA-BLR-JAYANAGAR", name: "Sub-Registrar Jayanagar", districtId: 3 },
      { id: 5, code: "MH-MUM-ANDHERI-1", name: "Joint Sub-Registrar Andheri-1", districtId: 4 },
    ],
    pincodeSro: [
      { pincode: "110017", sroId: 1, isPrimary: true, confidence: 90 },
      { pincode: "122001", sroId: 3, isPrimary: true, confidence: 70 },
      { pincode: "122001", sroId: 2, isPrimary: false, confidence: 30 },
      { pincode: "560034", sroId: 4, isPrimary: true, confidence: 80 },
      { pincode: "400053", sroId: 5, isPrimary: true, confidence: 80 },
    ],
    stampRates: [
      { ...base, id: 1, stateCode: "DL", documentType: "RENT_AGREEMENT", chargeType: "STAMP_DUTY", articleRef: "Lease ≤ 1 yr", basis: "FIXED", fixedAmountPaise: 10_000, conditions: { maxTermMonths: 11 } },
      { ...base, id: 2, stateCode: "HR", documentType: "RENT_AGREEMENT", chargeType: "STAMP_DUTY", articleRef: "Lease ≤ 5 yr", basis: "AVG_ANNUAL_RENT_PLUS_DEPOSIT", rateBps: 150, minAmountPaise: 10_000, conditions: { maxTermMonths: 11 } },
      { ...base, id: 3, stateCode: "KA", documentType: "RENT_AGREEMENT", chargeType: "STAMP_DUTY", articleRef: "Art. 30 lease ≤ 1 yr", basis: "AVG_ANNUAL_RENT_PLUS_DEPOSIT", rateBps: 50, maxAmountPaise: 50_000, conditions: { maxTermMonths: 11 } },
      { ...base, id: 4, stateCode: "MH", documentType: "LEAVE_AND_LICENCE", chargeType: "STAMP_DUTY", articleRef: "Art. 36A", basis: "MH_LEAVE_AND_LICENCE", rateBps: 25, minAmountPaise: 10_000 },
      { ...base, id: 5, stateCode: "MH", areaType: "METRO", documentType: "LEAVE_AND_LICENCE", chargeType: "REGISTRATION_FEE", basis: "FIXED", fixedAmountPaise: 100_000 },
      { ...base, id: 6, stateCode: "MH", areaType: "RURAL", documentType: "LEAVE_AND_LICENCE", chargeType: "REGISTRATION_FEE", basis: "FIXED", fixedAmountPaise: 50_000 },
      { ...base, id: 7, stateCode: "HR", areaType: "URBAN", documentType: "SALE_AGREEMENT", chargeType: "STAMP_DUTY", basis: "MAX_CONSIDERATION_MARKET_VALUE", rateBps: 700 },
      { ...base, id: 8, stateCode: "HR", areaType: "URBAN", documentType: "SALE_AGREEMENT", chargeType: "STAMP_DUTY", basis: "MAX_CONSIDERATION_MARKET_VALUE", rateBps: 500, conditions: { buyerGender: "FEMALE" }, priority: 10 },
    ],
  };
}
