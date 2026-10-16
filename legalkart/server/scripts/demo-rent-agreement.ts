// Runs the whole Rent Agreement flow in sandbox mode and writes the outputs
// to ../samples/: stamped PDF, editable DOCX, and the instance snapshot JSON.
//   npm run demo
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildContainer } from "../src/container.ts";
import type { ConsoleOtpProvider } from "../src/otp/providers.ts";
import type { FakeRazorpayGateway } from "../src/payments/razorpay.ts";
import { sampleForm } from "../test/fixtures.ts";

const out = fileURLToPath(new URL("../../samples/", import.meta.url));
mkdirSync(out, { recursive: true });
const c = buildContainer({ NODE_ENV: "development" });
const r = c.rent;

const { document: doc, resolution } = await r.createDraft("demo-user", { pincode: "122001" });
console.log(`Draft ${doc.referenceNo}: ${resolution.stateName}, SRO candidates:`, resolution.sroCandidates.map((s) => `${s.code} (${s.confidence}%)`).join(", "));
await r.confirmSro(doc.id, "HR-GGN-GURGAON");
await r.saveForm(doc.id, sampleForm);

await r.addParty(doc.id, { role: "LANDLORD", fullName: "Rajesh Kumar", phoneE164: "+919810000001", details: { relation: "S/o", relationName: "Shri Ram Kumar", age: 52, address: "H.No. 118, Sector 14, Gurugram, Haryana 122001" } });
const tenant = await r.addParty(doc.id, { role: "TENANT", fullName: "Asha Rao", phoneE164: "+919820000002", details: { relation: "D/o", relationName: "Shri K. Rao", age: 29, address: "12 MG Road, Bengaluru, Karnataka 560001" } });
await r.addParty(doc.id, { role: "WITNESS", fullName: "Vikram Singh", phoneE164: "+919830000003", details: { address: "Sector 15, Gurugram" } });

const sent = await r.sendPartyOtp(doc.id, tenant.id, "SMS");
await r.verifyPartyOtp(doc.id, sent.verificationId, (c.otpProviders.SMS as ConsoleOtpProvider).outbox.get(tenant.phoneE164)!);

const { quote, price } = await r.quote(doc.id);
for (const l of quote.lines) console.log(`  ${l.chargeType}: ${l.explanation} = ₹${l.amountPaise / 100}`);
console.log(`  Total payable: ₹${price.totalPaise / 100} (duty ₹${price.govtDutyPaise / 100} + fees ₹${(price.serviceFeePaise + price.vendorFeePaise) / 100} + GST ₹${price.gstPaise / 100})`);

const order = await r.createPayment(doc.id);
await r.confirmPayment(doc.id, { orderId: order.orderId, paymentId: "pay_DEMO1", signature: (c.gateway as FakeRazorpayGateway).sign(order.orderId, "pay_DEMO1") });
const tx = await r.purchaseEStamp(doc.id);
console.log(`E-stamp ${tx.status}: ${tx.certificateNo} via ${tx.provider}`);

const { pdf, docx, html } = await r.generate(doc.id, { pdf: true });
writeFileSync(`${out}rent-agreement-sample.pdf`, pdf!.pdf);
writeFileSync(`${out}rent-agreement-sample.docx`, docx);
writeFileSync(`${out}rent-agreement-sample.html`, html);
writeFileSync(`${out}rent-agreement-instance.json`, JSON.stringify(await r.snapshot(doc.id, pdf!.sha256), null, 2) + "\n");
console.log(`Wrote samples to ${out} (sha256 ${pdf!.sha256.slice(0, 16)}…)`);
