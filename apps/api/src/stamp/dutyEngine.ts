// Stamp duty / registration fee engine. Pure functions over stamp_rates rows —
// no rates are hard-coded here. See docs §C.3 for the selection rules.
import { createHash } from "node:crypto";
import { applyBps, ceilTo, formatInr, type Paise } from "../money.ts";
import type { AreaType, ChargeType, DutyLine, DutyQuote, StampRate } from "../types.ts";

export interface DutyInputs {
  considerationPaise?: Paise;
  marketValuePaise?: Paise;
  monthlyRentPaise?: Paise;
  securityDepositPaise?: Paise;
  termMonths?: number;
  buyerGender?: "MALE" | "FEMALE" | "OTHER";
}

export interface DutyContext {
  stateCode: string;
  districtId: number | null;
  areaType: AreaType;
  documentType: string;
  onDate: string; // YYYY-MM-DD, normally the expected execution date
  /** Production: true. Unverified (illustrative) rows are then rejected. */
  requireVerifiedRates: boolean;
}

export class DutyError extends Error {
  constructor(public code: "NO_RATE" | "MISSING_INPUT" | "UNVERIFIED_RATE", message: string) {
    super(message);
  }
}

const CHARGE_ORDER: ChargeType[] = ["STAMP_DUTY", "SURCHARGE", "CESS", "REGISTRATION_FEE", "MUTATION_FEE", "PROCESSING_FEE"];

function conditionsMatch(conditions: Record<string, unknown>, inputs: DutyInputs): boolean {
  for (const [key, expected] of Object.entries(conditions)) {
    switch (key) {
      case "maxTermMonths":
        if (inputs.termMonths === undefined || inputs.termMonths > Number(expected)) return false;
        break;
      case "minTermMonths":
        if (inputs.termMonths === undefined || inputs.termMonths < Number(expected)) return false;
        break;
      case "buyerGender":
        if (inputs.buyerGender !== expected) return false;
        break;
      case "maxConsiderationPaise":
        if ((inputs.considerationPaise ?? 0) > Number(expected)) return false;
        break;
      default:
        // Unknown condition keys never match: safer to fail with NO_RATE than to
        // silently apply a rule we do not understand.
        return false;
    }
  }
  return true;
}

/**
 * Pick the single most specific applicable row for one charge type.
 * Specificity: district > state-wide, specific area type > ANY, more
 * conditions > fewer, then explicit priority.
 */
export function selectRate(rows: StampRate[], ctx: DutyContext, chargeType: ChargeType, inputs: DutyInputs): StampRate | null {
  const candidates = rows.filter((r) =>
    r.chargeType === chargeType &&
    r.stateCode === ctx.stateCode &&
    r.documentType === ctx.documentType &&
    r.effectiveFrom <= ctx.onDate &&
    (r.effectiveTo === null || r.effectiveTo >= ctx.onDate) &&
    (r.districtId === null || r.districtId === ctx.districtId) &&
    (r.areaType === "ANY" || r.areaType === ctx.areaType) &&
    conditionsMatch(r.conditions, inputs),
  );
  const score = (r: StampRate) => [
    r.districtId !== null ? 1 : 0,
    r.areaType !== "ANY" ? 1 : 0,
    Object.keys(r.conditions).length,
    r.priority,
  ];
  candidates.sort((a, b) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i]! - sa[i]!;
    return 0;
  });
  return candidates[0] ?? null;
}

function need<T>(v: T | undefined, name: string): T {
  if (v === undefined || v === null) throw new DutyError("MISSING_INPUT", `Stamp duty needs ${name}`);
  return v;
}

/** The amount the % rate is applied to, plus a human explanation. */
export function baseAmount(rate: StampRate, inputs: DutyInputs): { base: Paise; how: string } {
  switch (rate.basis) {
    case "FIXED":
      return { base: 0, how: "fixed amount" };
    case "CONSIDERATION":
    case "SLAB": {
      const c = need(inputs.considerationPaise, "consideration");
      return { base: c, how: `consideration ${formatInr(c)}` };
    }
    case "MAX_CONSIDERATION_MARKET_VALUE": {
      const c = need(inputs.considerationPaise, "consideration");
      const mv = inputs.marketValuePaise ?? 0;
      return mv > c
        ? { base: mv, how: `market (circle-rate) value ${formatInr(mv)}, higher than consideration ${formatInr(c)}` }
        : { base: c, how: `consideration ${formatInr(c)}` };
    }
    case "AVG_ANNUAL_RENT_PLUS_DEPOSIT": {
      const rent = need(inputs.monthlyRentPaise, "monthly rent");
      const term = need(inputs.termMonths, "term");
      const deposit = inputs.securityDepositPaise ?? 0;
      // For a term under a year the "average annual rent" is the whole rent reserved.
      // (Flat rent assumed; escalating rents need the year-wise average.)
      const avgAnnual = term <= 12 ? rent * term : rent * 12;
      return { base: avgAnnual + deposit, how: `average annual rent ${formatInr(avgAnnual)} + deposit ${formatInr(deposit)}` };
    }
    case "TOTAL_RENT_PLUS_DEPOSIT": {
      const rent = need(inputs.monthlyRentPaise, "monthly rent");
      const term = need(inputs.termMonths, "term");
      const deposit = inputs.securityDepositPaise ?? 0;
      return { base: rent * term + deposit, how: `total rent ${formatInr(rent * term)} + deposit ${formatInr(deposit)}` };
    }
    case "MH_LEAVE_AND_LICENCE": {
      // Licence fee for the whole term + notional interest @10% p.a. on the refundable deposit.
      const rent = need(inputs.monthlyRentPaise, "monthly rent");
      const term = need(inputs.termMonths, "term");
      const deposit = inputs.securityDepositPaise ?? 0;
      const interest = Math.ceil((deposit * 10 * term) / (100 * 12));
      return { base: rent * term + interest, how: `licence fee ${formatInr(rent * term)} + 10% p.a. notional interest on deposit ${formatInr(interest)}` };
    }
  }
}

export function computeLine(rate: StampRate, inputs: DutyInputs): DutyLine {
  const { base, how } = baseAmount(rate, inputs);
  let amount: Paise;
  let explanation: string;
  if (rate.basis === "FIXED") {
    amount = rate.fixedAmountPaise!;
    explanation = `Fixed ${formatInr(amount)}`;
  } else if (rate.basis === "SLAB") {
    // Bracket (not progressive): the whole base takes the rate of the bracket it falls in.
    const slab = rate.slabs!.find((s) => s.uptoPaise === null || base <= s.uptoPaise) ?? rate.slabs!.at(-1)!;
    amount = applyBps(base, slab.rateBps);
    explanation = `${slab.rateBps / 100}% of ${how}`;
  } else {
    amount = applyBps(base, rate.rateBps!);
    explanation = `${rate.rateBps! / 100}% of ${how}`;
  }
  if (rate.minAmountPaise !== null && amount < rate.minAmountPaise) {
    amount = rate.minAmountPaise;
    explanation += `, raised to minimum ${formatInr(amount)}`;
  }
  if (rate.maxAmountPaise !== null && amount > rate.maxAmountPaise) {
    amount = rate.maxAmountPaise;
    explanation += `, capped at maximum ${formatInr(amount)}`;
  }
  amount = ceilTo(amount, rate.roundingUnitPaise);
  return {
    chargeType: rate.chargeType,
    amountPaise: amount,
    basis: rate.basis,
    baseAmountPaise: base,
    rateBps: rate.rateBps,
    rateId: rate.id,
    articleRef: rate.articleRef,
    explanation,
    payableAt: rate.chargeType === "STAMP_DUTY" || rate.chargeType === "SURCHARGE" || rate.chargeType === "CESS" ? "ESTAMP" : "SRO",
  };
}

export function quoteDuty(rows: StampRate[], ctx: DutyContext, inputs: DutyInputs, now = new Date()): DutyQuote {
  const lines: DutyLine[] = [];
  let verified = true;
  for (const chargeType of CHARGE_ORDER) {
    const rate = selectRate(rows, ctx, chargeType, inputs);
    if (!rate) continue;
    if (!rate.verifiedAt) {
      verified = false;
      if (ctx.requireVerifiedRates) {
        throw new DutyError("UNVERIFIED_RATE", `Rate #${rate.id} (${ctx.stateCode} ${chargeType}) has not been legally verified`);
      }
    }
    lines.push(computeLine(rate, inputs));
  }
  if (!lines.some((l) => l.chargeType === "STAMP_DUTY")) {
    throw new DutyError("NO_RATE", `No stamp duty rule for ${ctx.documentType} in ${ctx.stateCode} (${ctx.areaType}) on ${ctx.onDate}`);
  }
  const totalGovtPaise = lines.reduce((s, l) => s + l.amountPaise, 0);
  const estampAmountPaise = lines.filter((l) => l.payableAt === "ESTAMP").reduce((s, l) => s + l.amountPaise, 0);
  // The hash binds payment to exactly this quote; any input change forces a re-quote.
  const quoteHash = createHash("sha256")
    .update(JSON.stringify({ ctx: { ...ctx, requireVerifiedRates: undefined }, inputs, lines }))
    .digest("hex");
  return { stateCode: ctx.stateCode, lines, totalGovtPaise, estampAmountPaise, quoteHash, quotedAt: now.toISOString(), verifiedRates: verified };
}
