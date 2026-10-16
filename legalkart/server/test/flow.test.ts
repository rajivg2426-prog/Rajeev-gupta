// End-to-end Rent Agreement flow through the HTTP API, in sandbox mode:
// pincode → draft → form → parties → tenant OTP → quote → Razorpay → e-stamp → PDF/DOCX.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { buildContainer } from "../src/container.ts";
import { validateInstanceSchema } from "../src/documents/template.ts";
import { buildApp } from "../src/http/app.ts";
import type { ConsoleOtpProvider } from "../src/otp/providers.ts";
import type { FakeRazorpayGateway } from "../src/payments/razorpay.ts";
import { sampleForm } from "./fixtures.ts";
import { rupees } from "../src/money.ts";

const HAS_CHROMIUM = existsSync(process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium");


test("rent agreement: full flow with OTP gate and e-stamp", { timeout: 60_000 }, async () => {
  const c = buildContainer({ NODE_ENV: "test", SKIP_PDF: HAS_CHROMIUM ? "0" : "1" });
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
  const id = draft.body.id as string;
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
  await call("POST", `/v1/rent-agreements/${id}/parties`, { role: "WITNESS", fullName: "Vikram Singh", phoneE164: "+919830000003", details: { address: "Sector 15, Gurugram" } });

  // 4. Quote is blocked until the tenant verifies
  const blocked = await call("POST", `/v1/rent-agreements/${id}/quote`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, "VERIFICATION_PENDING");

  // 5. Tenant OTP via WhatsApp; one wrong attempt, then the right one
  const sent = await call("POST", `/v1/rent-agreements/${id}/parties/${tenant.body.id}/otp`, { channel: "WHATSAPP" });
  assert.equal(sent.body.channel, "WHATSAPP");
  assert.equal(sent.body.phoneMasked, "+91******0002");
  const code = (c.otpProviders.WHATSAPP as ConsoleOtpProvider).outbox.get("+919820000002")!;
  const wrong = await call("POST", `/v1/rent-agreements/${id}/verifications/${sent.body.verificationId}`, { otp: code === "123456" ? "654321" : "123456" });
  assert.equal(wrong.body.code, "INVALID_OTP");
  assert.equal(wrong.body.details.attemptsLeft, 4);
  const ok = await call("POST", `/v1/rent-agreements/${id}/verifications/${sent.body.verificationId}`, { otp: code });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.pendingPartyIds, []);

  // 6. Quote: HR 1.5% × (25,000 × 11 + 50,000) = ₹4,875; + ₹199 service + ₹50 vendor + 18% GST
  const quote = await call("POST", `/v1/rent-agreements/${id}/quote`);
  assert.equal(quote.status, 200);
  assert.equal(quote.body.quote.estampAmountPaise, rupees(4875));
  assert.equal(quote.body.price.totalPaise, rupees(4875 + 199 + 50) + Math.ceil(rupees(249) * 0.18));

  const preview = await call("GET", `/v1/rent-agreements/${id}/preview`);
  assert.match(preview.body as string, /DRAFT — NOT STAMPED/);

  // 7. Payment (fake gateway signs like Razorpay)
  const order = await call("POST", `/v1/rent-agreements/${id}/payments`);
  const gw = c.gateway as FakeRazorpayGateway;
  const badSig = await call("POST", `/v1/rent-agreements/${id}/payments/confirm`, { orderId: order.body.orderId, paymentId: "pay_X", signature: "00" });
  assert.equal(badSig.body.code, "BAD_SIGNATURE");
  const paid = await call("POST", `/v1/rent-agreements/${id}/payments/confirm`, {
    orderId: order.body.orderId, paymentId: "pay_TEST1", signature: gw.sign(order.body.orderId, "pay_TEST1"),
  });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.eStamp.status, "ISSUED");
  assert.match(paid.body.eStamp.certificateNo, /^IN-HR\d{14}[A-Z]$/);

  // Webhook replay after capture must not buy a second stamp
  const raw = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_TEST1", order_id: order.body.orderId } } } });
  const { createHmac } = await import("node:crypto");
  const hook = await app.inject({ method: "POST", url: "/v1/webhooks/razorpay", payload: raw, headers: { "content-type": "application/json", "x-razorpay-signature": createHmac("sha256", gw.secret).update(raw).digest("hex") } });
  assert.equal(hook.statusCode, 200);
  assert.equal([...c.store.eStamps.values()].length, 1);

  // 8. Generate stamped PDF + DOCX
  const gen = await call("POST", `/v1/rent-agreements/${id}/generate`);
  assert.equal(gen.status, 200, JSON.stringify(gen.body));
  const docx = await app.inject({ method: "GET", url: gen.body.files.docx, headers: H });
  assert.equal(docx.rawPayload.subarray(0, 2).toString(), "PK");
  if (HAS_CHROMIUM) {
    const pdf = await app.inject({ method: "GET", url: gen.body.files.pdf, headers: H });
    assert.equal(pdf.rawPayload.subarray(0, 5).toString(), "%PDF-");
    assert.match(gen.body.sha256, /^[a-f0-9]{64}$/);
  }

  // Snapshot conforms to the published instance schema
  const snap = await c.rent.snapshot(id, gen.body.sha256);
  assert.ok(validateInstanceSchema(snap), JSON.stringify(validateInstanceSchema.errors, null, 2));
  assert.equal(snap.parties.find((p) => p.role === "TENANT")!.verification.status, "VERIFIED");

  // Other users cannot read it
  assert.equal((await call("GET", `/v1/rent-agreements/${id}/files/docx`, undefined, { "x-user-id": "intruder" })).status, 403);
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
