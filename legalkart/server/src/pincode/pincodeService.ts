// Pincode → state / district / area type / Sub-Registrar Office.
//
// Production query (Postgres):
//   SELECT p.pincode, p.office_name, p.area_type, d.id AS district_id, d.name AS district,
//          d.lgd_code, s.code AS state_code, s.name AS state_name, s.estamp_enabled
//     FROM pincodes p
//     JOIN districts d ON d.id = p.district_id
//     JOIN states s    ON s.code = p.state_code
//    WHERE p.pincode = $1;
//   SELECT m.confidence, m.is_primary, o.*
//     FROM pincode_sro_map m JOIN sub_registrar_offices o ON o.id = m.sro_id
//    WHERE m.pincode = $1 AND o.is_active ORDER BY m.is_primary DESC, m.confidence DESC;
//
// Results are cached in Redis for 24h (key pincode:v1:<pin>); the table is
// refreshed monthly from the India Post directory, which invalidates the cache.
import type { MemoryStore } from "../store.ts";
import type { AreaType, PincodeData } from "../types.ts";

export const SRO_AUTO_SELECT_CONFIDENCE = 80;

export class PincodeError extends Error {
  constructor(public code: "INVALID_PINCODE" | "PINCODE_NOT_FOUND" | "STATE_NOT_SUPPORTED" | "SRO_NOT_IN_PINCODE", message: string) {
    super(message);
  }
}

export interface PincodeResolution {
  pincode: string;
  stateCode: string;
  stateName: string;
  postOffices: string[];
  districts: { id: number; name: string; lgdCode: number | null }[];
  areaType: AreaType;
  sroCandidates: { code: string; name: string; confidence: number; isPrimary: boolean }[];
  /** Set when the mapping is unambiguous enough to skip the "confirm your SRO" step. */
  autoSelectedSroCode: string | null;
  needsUserConfirmation: boolean;
}

export class PincodeService {
  constructor(private store: MemoryStore) {}

  async resolve(pincode: string, opts: { allowedStates?: string[] } = {}): Promise<PincodeResolution> {
    if (!/^[1-9][0-9]{5}$/.test(pincode)) {
      throw new PincodeError("INVALID_PINCODE", "Pincode must be 6 digits and cannot start with 0");
    }
    const rows = await this.store.findPincodeRows(pincode);
    if (rows.length === 0) {
      throw new PincodeError("PINCODE_NOT_FOUND", `Pincode ${pincode} is not in our directory yet`);
    }
    const states = [...new Set(rows.map((r) => r.stateCode))];
    if (states.length > 1) {
      // Real but rare (border pincodes). We never guess the state: duty depends on it.
      throw new PincodeError("STATE_NOT_SUPPORTED", `Pincode ${pincode} spans ${states.join(", ")}; please contact support`);
    }
    const first = rows[0]!;
    if (opts.allowedStates?.length && !opts.allowedStates.includes(first.stateCode)) {
      throw new PincodeError("STATE_NOT_SUPPORTED", `This document is not yet available for ${first.stateName}`);
    }

    const districts = [...new Map(rows.map((r) => [r.districtId, { id: r.districtId, name: r.districtName, lgdCode: r.districtLgdCode }])).values()];
    // Most-specific area type wins; mixed pincodes fall back to the stricter (higher-duty) URBAN.
    const areaTypes = new Set(rows.map((r) => r.areaType));
    const areaType: AreaType = areaTypes.size === 1 ? first.areaType : areaTypes.has("METRO") ? "METRO" : "URBAN";

    const sros = await this.store.findSrosForPincode(pincode);
    const sroCandidates = sros.map(({ link, sro }) => ({ code: sro.code, name: sro.name, confidence: link.confidence, isPrimary: link.isPrimary }));
    const top = sroCandidates[0];
    const autoSelectedSroCode = top && top.isPrimary && top.confidence >= SRO_AUTO_SELECT_CONFIDENCE ? top.code : null;

    return {
      pincode,
      stateCode: first.stateCode,
      stateName: first.stateName,
      postOffices: rows.map((r) => r.officeName),
      districts,
      areaType,
      sroCandidates,
      autoSelectedSroCode,
      needsUserConfirmation: districts.length > 1 || autoSelectedSroCode === null,
    };
  }

  /** Freeze the resolution (plus the user's SRO choice) into the document's pincodeData. */
  async toPincodeData(res: PincodeResolution, chosenSroCode: string | null, userConfirmed: boolean): Promise<PincodeData> {
    const code = chosenSroCode ?? res.autoSelectedSroCode;
    const candidate = code ? res.sroCandidates.find((c) => c.code === code) : undefined;
    if (code && !candidate) {
      throw new PincodeError("SRO_NOT_IN_PINCODE", `SRO ${code} does not serve pincode ${res.pincode}`);
    }
    const sro = code ? await this.store.findSroByCode(code) : null;
    const district = (sro && res.districts.find((d) => d.id === sro.districtId)) ?? res.districts[0]!;
    return {
      pincode: res.pincode,
      postOffice: res.postOffices[0],
      stateCode: res.stateCode,
      stateName: res.stateName,
      district: district.name,
      districtLgdCode: district.lgdCode,
      areaType: res.areaType,
      sro: sro ? { code: sro.code, name: sro.name, address: sro.address } : null,
      resolution: { confidence: candidate?.confidence ?? 0, userConfirmed, candidates: res.sroCandidates.length },
    };
  }
}
