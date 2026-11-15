// End-to-end Rent Agreement flow through the HTTP API, in sandbox mode:
// pincode → draft → form → parties → tenant OTP → stamp details (portal handoff)
// → generate without a certificate → add certificate → regenerate.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { buildContainer } from "../src/container.ts";
import { validateInstanceSchema } from "../src/documents/template.ts";
import { buildApp } from "../src/http/app.ts";
import type { ConsoleOtpProvider } from "../src/otp/providers.ts";
import { sampleForm } from "./fixtures.ts";
import { rupees } from "../src/money.ts";

const HAS_CHROMIUM = existsSync(process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium");

test("rent agreement: OTP gate, portal handoff, optional certificate", { timeout: 60_000 }, async () => {
  const c = buildContainer({ NODE_ENV: "test" });
  process.env.SKIP_PDF = HAS_CHROMIUM ? "0" : "1";
  const app = buildApp(c, { logger: false });
  const H = { "x-user-id": "user-1" };
  const call = async (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown, headers = H) => {
    const res = await app.inject({ method, url, payload: payload as any, headers });
    return { status: res.statusCode, body: res.headers["content-type"]?.includes("json") ? res.json() : res.body };
  };

  // 1. Pincode → jurisdiction (Gurugram needs SRO confirmation)
  const pin = await call("GET", "/v1/pincodes/122001");
  assert.equal(pin.status, 200);
  assert.equal(pin.body.stateCode, "HR");
  assert.equal(pin.body.needsUserConfirmation, true);
  assert.equal((await call("GET", "/v1/pincodes/400053")).body.code, "STATE_NOT_SUPPORTED");

  const draft = await call("POST", "/v1/rent-agreements", { pincode: "122001" });
  assert.equal(draft.status, 201);
  assert.equal(draft.body.document.status, "DRAFT");
  const id = draft.body.document.id as string;
  const sro = await call("PUT", `/v1/rent-agreements/${id}/sro`, { sroCode: "HR-GGN-GURGAON" });
  assert.equal(sro.body.resolution.userConfirmed, true);

  // 2. Form
  const form = await call("PUT", `/v1/rent-agreements/${id}/form`, sampleForm);
  assert.deepEqual(form.body.errors, []);

  // 3. Parties
  const landlord = await call("POST", `/v1/rent-agreements/${id}/parties`, {
    role: "LANDLORD", fullName: "Rajesh Kumar", phoneE164: "+919810000001",
    details: { relation: "S/o", relationName: "Shri Ram Kumar", age: 52, address: "H.No. 118, Sector 14, Gurugram, Haryana 122001" },
  });
  const tenant = await call("POST", `/v1/rent-agreements/${id}/parties`, {
    role: "TENANT", fullName: "Asha Rao", phoneE164: "+919820000002",
    details: { relation: "D/o", relationName: "Shri K. Rao", age: 29, address: "12 MG Road, Bengaluru, Karnataka 560001" },
  });
  assert.equal(landlord.body.otpRequired, false);
  assert.equal(tenant.body.otpRequired, true);
  assert.equal(tenant.body.phoneMasked, "+91******0002");
  await call("POST", `/v1/rent-agreements/${id}/parties`, { role: "WITNESS", fullName: "Vikram Singh", phoneE164: "+919830000003", details: { address: "Sector 15, Gurugram" } });

  const view = await call("GET", `/v1/rent-agreements/${id}`);
  assert.equal(view.body.document.status, "AWAITING_VERIFICATION");
  assert.equal(view.body.parties.length, 3);
  assert.equal(view.body.stampDetails, null);

  // 4. Stamp details are blocked until the tenant verifies
  const blocked = await call("POST", `/v1/rent-agreements/${id}/stamp-details`, { acceptDisclaimer: true });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, "VERIFICATION_PENDING");

  // 5. Tenant OTP via WhatsApp; one wrong attempt, then the right one
  const sent = await call("POST", `/v1/rent-agreements/${id}/parties/${tenant.body.id}/otp`, { channel: "WHATSAPP" });
  assert.equal(sent.body.channel, "WHATSAPP");
  const code = (c.otpProviders.WHATSAPP as ConsoleOtpProvider).outbox.get("+919820000002")!;
  const wrong = await call("POST", `/v1/rent-agreements/${id}/verifications/${sent.body.verificationId}`, { otp: code === "123456" ? "654321" : "123456" });
  assert.equal(wrong.body.code, "INVALID_OTP");
  assert.equal(wrong.body.details.attemptsLeft, 4);
  const ok = await call("POST", `/v1/rent-agreements/${id}/verifications/${sent.body.verificationId}`, { otp: code });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.pendingPartyIds, []);

  // 6. Disclaimer must be accepted, then: HR 1.5% × (25,000 × 11 + 50,000) = ₹4,875
  const noDisclaimer = await call("POST", `/v1/rent-agreements/${id}/stamp-details`, {});
  assert.equal(noDisclaimer.status, 400);
  assert.equal(noDisclaimer.body.code, "DISCLAIMER_REQUIRED");
  const details = await call("POST", `/v1/rent-agreements/${id}/stamp-details`, { acceptDisclaimer: true });
  assert.equal(details.status, 200, JSON.stringify(details.body));
  assert.equal(details.body.dutyPaise, rupees(4875));
  assert.equal(details.body.portal.url, "https://egrashry.nic.in/");
  const field = (k: string) => details.body.fields.find((f: { key: string }) => f.key === k)?.value;
  assert.equal(field("stampDutyAmount"), "4875");
  assert.equal(field("firstParty"), "Rajesh Kumar");
  assert.equal(field("secondParty"), "Asha Rao");
  assert.equal(field("stampDutyPaidBy"), "Asha Rao");
  assert.equal(field("article"), "Article 35 Lease");
  assert.match(details.body.disclaimer, /exactly ₹4,875/);
  assert.deepEqual((await call("GET", `/v1/rent-agreements/${id}/stamp-details`)).body, details.body);
  assert.equal((await call("GET", `/v1/rent-agreements/${id}`)).body.document.status, "READY_TO_STAMP");

  const preview = await call("GET", `/v1/rent-agreements/${id}/preview`);
  assert.match(preview.body as string, /DRAFT — NOT STAMPED/);

  // 7. Skip the certificate: generate straight away
  const gen1 = await call("POST", `/v1/rent-agreements/${id}/generate`);
  assert.equal(gen1.status, 200, JSON.stringify(gen1.body));
  assert.equal(gen1.body.status, "GENERATED");
  assert.equal(gen1.body.certificateNo, null);
  const docx = await app.inject({ method: "GET", url: gen1.body.files.docx, headers: H });
  assert.equal(docx.rawPayload.subarray(0, 2).toString(), "PK");

  // The agreement can no longer be edited once generated
  assert.equal((await call("PUT", `/v1/rent-agreements/${id}/form`, sampleForm)).body.code, "INVALID_STATE");

  // 8. Add the certificate later: bad format rejected, good one marks files stale
  const bad = await call("PUT", `/v1/rent-agreements/${id}/certificate`, { certificateNo: "12" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "INVALID_CERTIFICATE");
  const cert = await call("PUT", `/v1/rent-agreements/${id}/certificate`, { certificateNo: " hr0123456789ab " });
  assert.equal(cert.status, 200);
  assert.deepEqual(cert.body, { certificateNo: "HR0123456789AB", needsRegeneration: true });

  const gen2 = await call("POST", `/v1/rent-agreements/${id}/generate`);
  assert.equal(gen2.body.certificateNo, "HR0123456789AB");
  assert.equal((await call("GET", `/v1/rent-agreements/${id}`)).body.document.needsRegeneration, false);
  if (HAS_CHROMIUM) {
    const pdf = await app.inject({ method: "GET", url: gen2.body.files.pdf, headers: H });
    assert.equal(pdf.rawPayload.subarray(0, 5).toString(), "%PDF-");
    assert.match(gen2.body.sha256, /^[a-f0-9]{64}$/);
  }

  // Snapshot conforms to the published instance schema
  const snap = await c.rent.snapshot(id, gen2.body.sha256 ?? undefined);
  assert.ok(validateInstanceSchema(snap), JSON.stringify(validateInstanceSchema.errors, null, 2));
  assert.equal(snap.parties.find((p) => p.role === "TENANT")!.verification.status, "VERIFIED");
  assert.equal(snap.eStamp?.certificateNo, "HR0123456789AB");

  // Other users cannot read it
  assert.equal((await call("GET", `/v1/rent-agreements/${id}/files/docx`, undefined, { "x-user-id": "intruder" })).status, 403);
  assert.equal((await call("GET", `/v1/rent-agreements/${id}`, undefined, { "x-user-id": "intruder" })).status, 403);
});

/** A Delhi agreement taken to READY_TO_STAMP through the service layer. */
async function readyDelhiAgreement(c: ReturnType<typeof buildContainer>, owner = "u") {
  const { document } = await c.rent.createDraft(owner, { pincode: "110017" });
  await c.rent.saveForm(document.id, sampleForm);
  await c.rent.addParty(document.id, { role: "LANDLORD", fullName: "Rajesh Kumar", phoneE164: "+919810000001" });
  const t = await c.rent.addParty(document.id, { role: "TENANT", fullName: "Asha Rao", phoneE164: "+919820000002" });
  const s = await c.rent.sendPartyOtp(document.id, t.id, "SMS");
  await c.rent.verifyPartyOtp(document.id, s.verificationId, (c.otpProviders.SMS as ConsoleOtpProvider).outbox.get(t.phoneE164)!);
  await c.rent.createStampDetails(document.id, { acceptDisclaimer: true });
  return document.id;
}

test("certificate: SHCIL format, one agreement per certificate, edits clear stamp details", async () => {
  const c = buildContainer({ NODE_ENV: "test" });
  const a = await readyDelhiAgreement(c, "u1");
  const b = await readyDelhiAgreement(c, "u2");

  await assert.rejects(c.rent.setCertificate(a, "IN-HR12345678901234A"), { code: "INVALID_CERTIFICATE" });
  assert.deepEqual(await c.rent.setCertificate(a, "in-dl12345678901234a"), { certificateNo: "IN-DL12345678901234A", needsRegeneration: false });
  await assert.rejects(c.rent.setCertificate(b, "IN-DL12345678901234A"), { code: "CERTIFICATE_IN_USE" });

  // Wording follows whether a certificate number was entered
  const withCert = (await c.rent.generate(a, { pdf: false })).model;
  assert.match(withCert.footerText, /^E-Stamp Certificate No\. IN-DL12345678901234A \(verify on the official portal\)/);
  assert.equal(withCert.watermark, null);
  assert.ok(withCert.clauses.some((cl) => /vide e-Stamp Certificate No\. IN-DL12345678901234A/.test(cl.text)));
  const without = (await c.rent.generate(b, { pdf: false })).model;
  assert.match(without.footerText, /^Attach the e-stamp certificate before signing/);
  assert.ok(without.clauses.some((cl) => /is paid by way of an e-stamp certificate attached/.test(cl.text)));

  // Editing before generation drops the stamp details and any certificate
  const d = await readyDelhiAgreement(c, "u3");
  await c.rent.setCertificate(d, "IN-DL99999999999999Z");
  await c.rent.saveForm(d, sampleForm);
  const doc = c.store.documents.get(d)!;
  assert.equal(doc.status, "DRAFT");
  assert.equal(doc.stampDetails, null);
  assert.equal(doc.certificateNo, null);
});

test("rent agreement: phone change resets verification", async () => {
  const c = buildContainer({ NODE_ENV: "test" });
  const { document } = await c.rent.createDraft("u", { pincode: "110017" });
  await c.rent.saveForm(document.id, sampleForm);
  const t = await c.rent.addParty(document.id, { role: "TENANT", fullName: "Asha Rao", phoneE164: "+919820000002" });
  const s = await c.rent.sendPartyOtp(document.id, t.id, "SMS");
  await c.rent.verifyPartyOtp(document.id, s.verificationId, (c.otpProviders.SMS as ConsoleOtpProvider).outbox.get("+919820000002")!);
  assert.equal(t.isVerified, true);
  await c.rent.updatePartyPhone(document.id, t.id, "+919820000099");
  assert.equal(t.isVerified, false);
  assert.equal(c.store.documents.get(document.id)!.status, "AWAITING_VERIFICATION");
});
