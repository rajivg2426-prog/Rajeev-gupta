// REST API (Fastify). Auth is stubbed with an x-user-id header so the sample
// runs standalone; production verifies a JWT from phone-OTP login instead and
// adds @fastify/rate-limit on the OTP and pincode routes.
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { Container } from "../container.ts";
import { EStampError } from "../estamp/estampService.ts";
import { OtpError } from "../otp/otpService.ts";
import { PincodeError } from "../pincode/pincodeService.ts";
import { FlowError } from "../rentAgreement/rentAgreementService.ts";
import { DutyError } from "../stamp/dutyEngine.ts";

const phone = z.string().regex(/^\+91[6-9]\d{9}$/, "Use +91 followed by a 10-digit mobile number");
const role = z.enum(["LANDLORD", "TENANT", "WITNESS"]);

const STATUS: Record<string, number> = {
  NOT_FOUND: 404, FORBIDDEN: 403, INVALID_STATE: 409, VERIFICATION_PENDING: 409, NOT_STAMPED: 409, NOT_PAID: 409,
  RATE_LIMITED: 429, RESEND_TOO_SOON: 429, BAD_SIGNATURE: 400, DELIVERY_FAILED: 502, NO_PROVIDER: 503,
};

export function buildApp(c: Container, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger === false ? false : { redact: ["req.headers.authorization", "body.otp"] } });
  const files = new Map<string, { pdf?: Uint8Array; docx?: Uint8Array }>();

  // Keep the raw body for webhook HMAC verification.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(422).send({ code: "VALIDATION", issues: err.issues });
    if (err instanceof FlowError || err instanceof OtpError || err instanceof PincodeError || err instanceof DutyError || err instanceof EStampError) {
      const details = err instanceof FlowError ? err.details : err instanceof OtpError ? err.meta : undefined;
      return reply.code(STATUS[err.code] ?? 422).send({ code: err.code, message: err.message, details });
    }
    app.log.error(err);
    return reply.code(500).send({ code: "INTERNAL", message: "Something went wrong" });
  });

  const userId = (req: FastifyRequest) => {
    const id = req.headers["x-user-id"];
    if (typeof id !== "string" || !id) throw new FlowError("FORBIDDEN", "Missing user");
    return id;
  };
  const ownDoc = (req: FastifyRequest<{ Params: { id: string } }>) => {
    const d = c.store.documents.get(req.params.id);
    if (!d) throw new FlowError("NOT_FOUND", "Document not found");
    if (d.ownerUserId !== userId(req)) throw new FlowError("FORBIDDEN", "Not your document");
    return d;
  };
  type P<T = {}> = FastifyRequest<{ Params: { id: string } & T }>;

  // --- reference -------------------------------------------------------------
  app.get<{ Params: { pincode: string } }>("/v1/pincodes/:pincode", async (req) =>
    c.pincodes.resolve(req.params.pincode, { allowedStates: c.template.jurisdiction.states }));

  app.get("/v1/templates/rent-agreement", async () => c.template);

  // --- rent agreement flow ---------------------------------------------------
  app.post("/v1/rent-agreements", async (req, reply) => {
    const body = z.object({ pincode: z.string(), sroCode: z.string().optional() }).parse(req.body);
    const { document, resolution } = await c.rent.createDraft(userId(req), body);
    return reply.code(201).send({ id: document.id, referenceNo: document.referenceNo, pincodeData: document.pincodeData, resolution });
  });

  app.put("/v1/rent-agreements/:id/sro", async (req: P) => {
    ownDoc(req);
    const { sroCode } = z.object({ sroCode: z.string() }).parse(req.body);
    return c.rent.confirmSro(req.params.id, sroCode);
  });

  app.put("/v1/rent-agreements/:id/form", async (req: P) => {
    ownDoc(req);
    return c.rent.saveForm(req.params.id, z.record(z.string(), z.any()).parse(req.body));
  });

  app.post("/v1/rent-agreements/:id/parties", async (req: P, reply) => {
    ownDoc(req);
    const body = z.object({ role, fullName: z.string().min(3), phoneE164: phone, details: z.record(z.string(), z.any()).optional() }).parse(req.body);
    const p = await c.rent.addParty(req.params.id, body);
    return reply.code(201).send({ id: p.id, role: p.role, sequence: p.sequence, otpRequired: p.otpRequired, isVerified: p.isVerified });
  });

  app.patch("/v1/rent-agreements/:id/parties/:partyId", async (req: P<{ partyId: string }>) => {
    ownDoc(req);
    const { phoneE164 } = z.object({ phoneE164: phone }).parse(req.body);
    const p = await c.rent.updatePartyPhone(req.params.id, req.params.partyId, phoneE164);
    return { id: p.id, isVerified: p.isVerified };
  });

  app.post("/v1/rent-agreements/:id/parties/:partyId/otp", async (req: P<{ partyId: string }>) => {
    ownDoc(req);
    const { channel } = z.object({ channel: z.enum(["SMS", "WHATSAPP"]).default("SMS") }).parse(req.body ?? {});
    return c.rent.sendPartyOtp(req.params.id, req.params.partyId, channel);
  });

  // Party-facing: the tenant may enter the code on the owner's phone or via a
  // deep link on their own device, so this route needs the document id only.
  app.post("/v1/rent-agreements/:id/verifications/:verificationId", async (req: P<{ verificationId: string }>) => {
    const { otp } = z.object({ otp: z.string().regex(/^\d{4,8}$/) }).parse(req.body);
    return c.rent.verifyPartyOtp(req.params.id, req.params.verificationId, otp);
  });

  app.post("/v1/rent-agreements/:id/quote", async (req: P) => {
    ownDoc(req);
    return c.rent.quote(req.params.id);
  });

  app.get("/v1/rent-agreements/:id/preview", async (req: P, reply: FastifyReply) => {
    ownDoc(req);
    return reply.type("text/html; charset=utf-8").send(await c.rent.previewHtml(req.params.id));
  });

  app.post("/v1/rent-agreements/:id/payments", async (req: P) => {
    ownDoc(req);
    return c.rent.createPayment(req.params.id);
  });

  app.post("/v1/rent-agreements/:id/payments/confirm", async (req: P) => {
    ownDoc(req);
    const body = z.object({ orderId: z.string(), paymentId: z.string(), signature: z.string() }).parse(req.body);
    const payment = await c.rent.confirmPayment(req.params.id, body);
    // Production: enqueue a BullMQ job instead of purchasing inline.
    const tx = await c.rent.purchaseEStamp(req.params.id);
    return { paymentStatus: payment.status, eStamp: { id: tx.id, status: tx.status, certificateNo: tx.certificateNo } };
  });

  app.post("/v1/webhooks/razorpay", async (req, reply) => {
    const sig = req.headers["x-razorpay-signature"];
    const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? "";
    const result = await c.rent.handlePaymentWebhook(raw, typeof sig === "string" ? sig : "");
    return reply.code(200).send(result);
  });

  app.post("/v1/rent-agreements/:id/estamp", async (req: P) => {
    ownDoc(req);
    const { fulfilmentMode } = z.object({ fulfilmentMode: z.enum(["DIGITAL_SELF_PRINT", "ACC_PRINT_COURIER"]).default("DIGITAL_SELF_PRINT") }).parse(req.body ?? {});
    const tx = await c.rent.purchaseEStamp(req.params.id, fulfilmentMode);
    return { id: tx.id, status: tx.status, certificateNo: tx.certificateNo, provider: tx.provider };
  });

  app.post("/v1/rent-agreements/:id/generate", async (req: P) => {
    const d = ownDoc(req);
    const out = await c.rent.generate(req.params.id, { pdf: process.env.SKIP_PDF !== "1" });
    files.set(d.id, { pdf: out.pdf?.pdf, docx: out.docx });
    return {
      status: d.status,
      sha256: out.pdf?.sha256,
      files: {
        pdf: out.pdf ? `/v1/rent-agreements/${d.id}/files/pdf` : null,
        docx: `/v1/rent-agreements/${d.id}/files/docx`,
      },
    };
  });

  app.get("/v1/rent-agreements/:id/files/:format", async (req: P<{ format: string }>, reply: FastifyReply) => {
    const d = ownDoc(req);
    const f = files.get(d.id);
    const fmt = req.params.format === "pdf" ? "pdf" : "docx";
    const bytes = f?.[fmt];
    if (!bytes) throw new FlowError("NOT_FOUND", "File not generated yet");
    return reply
      .type(fmt === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .header("content-disposition", `attachment; filename="Rent-Agreement-${d.referenceNo}.${fmt}"`)
      .send(Buffer.from(bytes));
  });

  return app;
}
