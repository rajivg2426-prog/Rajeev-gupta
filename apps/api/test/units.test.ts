import assert from "node:assert/strict";
import { test } from "node:test";
import { formatInr, inrInWords, numberToWords, rupees } from "../src/money.ts";
import { ConsoleOtpProvider } from "../src/otp/providers.ts";
import { DEFAULT_OTP_CONFIG, OtpError, OtpService } from "../src/otp/otpService.ts";
import { PincodeError, PincodeService } from "../src/pincode/pincodeService.ts";
import { DutyError, quoteDuty, type DutyContext } from "../src/stamp/dutyEngine.ts";
import { MemoryStore, sampleReferenceData } from "../src/store.ts";
import { loadTemplate, validateForm, withDefaults } from "../src/documents/template.ts";
import { addMonthsMinusOneDay, ordinal } from "../src/documents/render.ts";
import type { Party } from "../src/types.ts";

const ctx = (over: Partial<DutyContext>): DutyContext => ({
  stateCode: "HR", districtId: 2, areaType: "URBAN", documentType: "RENT_AGREEMENT", onDate: "2026-11-01", requireVerifiedRates: false, ...over,
});

test("money: Indian grouping and words", () => {
  assert.equal(formatInr(rupees(125000)), "₹1,25,000");
  assert.equal(formatInr(rupees(12345678.5)), "₹1,23,45,678.50");
  assert.equal(numberToWords(25000), "Twenty-Five Thousand");
  assert.equal(numberToWords(1_23_45_678), "One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight");
  assert.equal(inrInWords(rupees(25000)), "₹25,000/- (Rupees Twenty-Five Thousand Only)");
});

test("duty: Haryana rent = 1.5% of (rent × term + deposit)", () => {
  const rows = sampleReferenceData().stampRates;
  const q = quoteDuty(rows, ctx({}), { monthlyRentPaise: rupees(25000), termMonths: 11, securityDepositPaise: rupees(50000) });
  // (25,000 × 11 + 50,000) × 1.5% = 4,875
  assert.equal(q.estampAmountPaise, rupees(4875));
  assert.equal(q.lines[0]!.rateId, 2);
  assert.equal(q.verifiedRates, false);
});

test("duty: Karnataka cap and Delhi fixed", () => {
  const rows = sampleReferenceData().stampRates;
  const ka = quoteDuty(rows, ctx({ stateCode: "KA", districtId: 3 }), { monthlyRentPaise: rupees(40000), termMonths: 11, securityDepositPaise: rupees(200000) });
  assert.equal(ka.estampAmountPaise, rupees(500)); // 0.5% would be 3,200 → capped at 500
  const dl = quoteDuty(rows, ctx({ stateCode: "DL", districtId: 1, areaType: "METRO" }), { monthlyRentPaise: rupees(40000), termMonths: 11 });
  assert.equal(dl.estampAmountPaise, rupees(100));
});

test("duty: Maharashtra L&L adds registration fee payable at SRO", () => {
  const rows = sampleReferenceData().stampRates;
  const q = quoteDuty(rows, ctx({ stateCode: "MH", districtId: 4, areaType: "METRO", documentType: "LEAVE_AND_LICENCE" }),
    { monthlyRentPaise: rupees(30000), termMonths: 11, securityDepositPaise: rupees(100000) });
  // 0.25% × (3,30,000 + 10% p.a. × 1,00,000 × 11/12) = 847.92 → rounded up to ₹848
  assert.equal(q.lines.find((l) => l.chargeType === "STAMP_DUTY")!.amountPaise, rupees(848));
  assert.equal(q.lines.find((l) => l.chargeType === "REGISTRATION_FEE")!.payableAt, "SRO");
  assert.equal(q.estampAmountPaise, rupees(848));
  assert.equal(q.totalGovtPaise, rupees(1848));
});

test("duty: woman-buyer concession row wins; term > 11 months finds no rent rule", () => {
  const rows = sampleReferenceData().stampRates;
  const sale = (g: "MALE" | "FEMALE") => quoteDuty(rows, ctx({ documentType: "SALE_AGREEMENT" }), { considerationPaise: rupees(5_000_000), buyerGender: g });
  assert.equal(sale("MALE").estampAmountPaise, rupees(350000));
  assert.equal(sale("FEMALE").estampAmountPaise, rupees(250000));
  assert.throws(() => quoteDuty(rows, ctx({}), { monthlyRentPaise: 100, termMonths: 24 }), (e: DutyError) => e.code === "NO_RATE");
  assert.throws(() => quoteDuty(rows, ctx({ requireVerifiedRates: true }), { monthlyRentPaise: 100, termMonths: 11 }), (e: DutyError) => e.code === "UNVERIFIED_RATE");
});

test("pincode: auto-select vs confirmation, unsupported state", async () => {
  const svc = new PincodeService(new MemoryStore(sampleReferenceData()));
  const dl = await svc.resolve("110017");
  assert.equal(dl.stateCode, "DL");
  assert.equal(dl.autoSelectedSroCode, "DL-SD-SR-V");
  assert.equal(dl.needsUserConfirmation, false);
  const ggn = await svc.resolve("122001");
  assert.equal(ggn.needsUserConfirmation, true); // 70% < 80% threshold
  assert.deepEqual(ggn.sroCandidates.map((s) => s.code), ["HR-GGN-GURGAON", "HR-GGN-WAZIRABAD"]);
  await assert.rejects(svc.resolve("400053", { allowedStates: ["DL", "HR", "KA"] }), (e: PincodeError) => e.code === "STATE_NOT_SUPPORTED");
  await assert.rejects(svc.resolve("012345"), (e: PincodeError) => e.code === "INVALID_PINCODE");
  await assert.rejects(svc.resolve("999999"), (e: PincodeError) => e.code === "PINCODE_NOT_FOUND");
});

function otpFixture(now: { t: Date }) {
  const store = new MemoryStore(sampleReferenceData());
  const sms = new ConsoleOtpProvider("SMS");
  const svc = new OtpService(store, { SMS: sms }, { ...DEFAULT_OTP_CONFIG, pepper: "p" }, () => now.t);
  const party: Party = {
    id: "p1", documentId: "d1", role: "TENANT", sequence: 1, fullName: "Asha Rao", phoneE164: "+919812345678",
    details: {}, otpRequired: true, isVerified: false, verifiedAt: null,
  };
  store.parties.set(party.id, party);
  return { store, sms, svc, party };
}

test("otp: happy path stores only an HMAC and verifies the party", async () => {
  const now = { t: new Date("2026-10-16T10:00:00Z") };
  const { store, sms, svc, party } = otpFixture(now);
  const { verificationId } = await svc.start(party, "SMS", { documentLabel: "Rent Agreement", consentTextVersion: "v1" });
  const code = sms.outbox.get(party.phoneE164)!;
  assert.match(code, /^\d{6}$/);
  assert.ok(!JSON.stringify([...store.verifications.values()]).includes(`"${code}"`));
  await svc.verify(verificationId, code);
  assert.equal(party.isVerified, true);
});

test("otp: wrong codes lock after 5 attempts; expiry; resend cooldown", async () => {
  const now = { t: new Date("2026-10-16T10:00:00Z") };
  const { sms, svc, party } = otpFixture(now);
  const first = await svc.start(party, "SMS", { documentLabel: "x", consentTextVersion: "v1" });
  await assert.rejects(svc.start(party, "SMS", { documentLabel: "x", consentTextVersion: "v1" }), (e: OtpError) => e.code === "RESEND_TOO_SOON");
  const good = sms.outbox.get(party.phoneE164)!;
  const bad = good === "000000" ? "111111" : "000000";
  for (let i = 0; i < 4; i++) await assert.rejects(svc.verify(first.verificationId, bad), (e: OtpError) => e.code === "INVALID_OTP");
  await assert.rejects(svc.verify(first.verificationId, bad), (e: OtpError) => e.code === "LOCKED");
  await assert.rejects(svc.verify(first.verificationId, good), (e: OtpError) => e.code === "LOCKED");

  now.t = new Date(now.t.getTime() + 60_000);
  const second = await svc.start(party, "SMS", { documentLabel: "x", consentTextVersion: "v1" });
  now.t = new Date(now.t.getTime() + 301_000);
  await assert.rejects(svc.verify(second.verificationId, sms.outbox.get(party.phoneE164)!), (e: OtpError) => e.code === "EXPIRED");
});

test("otp: per-phone hourly cap", async () => {
  const now = { t: new Date("2026-10-16T10:00:00Z") };
  const { svc, party } = otpFixture(now);
  for (let i = 0; i < 5; i++) {
    await svc.start(party, "SMS", { documentLabel: "x", consentTextVersion: "v1" }).catch(() => {});
    now.t = new Date(now.t.getTime() + 31_000);
  }
  await assert.rejects(svc.start(party, "SMS", { documentLabel: "x", consentTextVersion: "v1" }), (e: OtpError) => e.code === "RATE_LIMITED");
});

test("template: rent agreement validates against JSON Schema and form rules", () => {
  const t = loadTemplate("rent-agreement.residential.json");
  const errors = validateForm(t, withDefaults(t, { property: { pincode: "122001" }, terms: { termMonths: 12 } }));
  const paths = errors.map((e) => e.path);
  assert.ok(paths.includes("property.address"));
  assert.ok(paths.includes("terms.monthlyRent"));
  assert.ok(errors.some((e) => e.path === "terms.termMonths" && /11 months/.test(e.message)));
});

test("render: tenancy end date and ordinals", () => {
  assert.equal(addMonthsMinusOneDay("2026-11-01", 11), "2027-09-30");
  assert.equal(addMonthsMinusOneDay("2026-01-31", 1), "2026-02-27");
  assert.equal(addMonthsMinusOneDay("2026-03-15", 11), "2027-02-14");
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"]);
});
