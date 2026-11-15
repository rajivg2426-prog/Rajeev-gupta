import { createHmac, randomInt } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatInr } from "../money.ts";
import type { EStampFulfilment } from "../types.ts";
import { EStampProviderError, type EStampProvider, type EStampRequest, type EStampResult } from "./provider.ts";

/**
 * Sandbox stand-in for a SHCIL partner integration. Issues certificates
 * shaped like real ones (IN-<STATE><14 digits><letter>) and renders a
 * certificate page so the full flow — including the stamped PDF — can be
 * exercised end to end. NEVER enable outside dev/test.
 */
export class MockShcilProvider implements EStampProvider {
  readonly name = "SHCIL_SANDBOX";
  private issued = new Map<string, EStampResult>();
  constructor(private opts: { async?: boolean; failWith?: string; states?: string[] } = {}) {}

  supports(stateCode: string, mode: EStampFulfilment) {
    return (this.opts.states ?? ["DL", "HR", "KA"]).includes(stateCode) && mode !== "FRANKING";
  }

  async purchase(req: EStampRequest, idempotencyKey: string): Promise<EStampResult> {
    const existing = this.issued.get(idempotencyKey);
    if (existing) return existing; // idempotent replay
    if (this.opts.failWith) return { status: "FAILED", failureReason: this.opts.failWith };

    const digits = Array.from({ length: 14 }, () => randomInt(10)).join("");
    const letter = String.fromCharCode(65 + randomInt(26));
    const certificateNo = `IN-${req.stateCode}${digits}${letter}`;
    const issuedAt = new Date();
    const result: EStampResult = {
      status: req.fulfilmentMode === "DIGITAL_SELF_PRINT" ? "ISSUED" : "FULFILMENT_PENDING",
      providerRequestId: `SBX-${digits.slice(0, 8)}`,
      certificateNo,
      uniqueDocReference: `SUBIN-${req.stateCode}SHCIL${digits.slice(4, 14)}${letter}`,
      issuedAt,
      accCode: `${req.stateCode}-SBX-ACC-001`,
      certificatePdf: await renderSandboxCertificate(req, certificateNo, issuedAt),
      verificationUrl: `https://estamp-verify.example.invalid/${certificateNo}`,
    };
    this.issued.set(idempotencyKey, result);
    return this.opts.async ? { status: "SUBMITTED", providerRequestId: result.providerRequestId } : result;
  }

  async status(ref: { providerRequestId?: string; idempotencyKey: string }): Promise<EStampResult> {
    const r = this.issued.get(ref.idempotencyKey);
    if (!r) throw new EStampProviderError(this.name, false, "Unknown request");
    return r;
  }
}

/**
 * Generic REST adapter for a contracted aggregator / ACC partner API.
 * The wire contract below is OUR proposed contract; align field names with
 * the partner's spec during onboarding. Requests are HMAC-signed and carry an
 * Idempotency-Key so a retried purchase can never buy a second stamp.
 */
export class AggregatorHttpProvider implements EStampProvider {
  constructor(
    readonly name: string,
    private cfg: { baseUrl: string; apiKey: string; signingSecret: string; states: string[]; timeoutMs?: number },
    private http: typeof fetch = fetch,
  ) {}

  supports(stateCode: string) {
    return this.cfg.states.includes(stateCode);
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string) {
    const ts = Math.floor(Date.now() / 1000).toString();
    const payload = body ? JSON.stringify(body) : "";
    const signature = createHmac("sha256", this.cfg.signingSecret).update(`${ts}.${method}.${path}.${payload}`).digest("hex");
    let res: Response;
    try {
      res = await this.http(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "x-api-key": this.cfg.apiKey,
          "x-timestamp": ts,
          "x-signature": signature,
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        body: payload || undefined,
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 20_000),
      });
    } catch (err) {
      // Network error / timeout after the request may have reached the vendor.
      throw new EStampProviderError(this.name, method === "POST", `network: ${String(err)}`);
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (res.status >= 500) throw new EStampProviderError(this.name, method === "POST", `vendor ${res.status}`);
    return { status: res.status, json };
  }

  private map(json: Record<string, any>): EStampResult {
    const status = String(json.status ?? "").toUpperCase();
    return {
      status: status === "ISSUED" ? "ISSUED" : status === "FAILED" || status === "REJECTED" ? "FAILED" : status === "DISPATCHED" ? "FULFILMENT_PENDING" : "SUBMITTED",
      providerRequestId: json.requestId,
      certificateNo: json.certificateNo,
      uniqueDocReference: json.uniqueDocReference,
      issuedAt: json.issuedAt ? new Date(json.issuedAt) : undefined,
      accCode: json.accCode,
      certificatePdf: json.certificatePdfBase64 ? Buffer.from(json.certificatePdfBase64, "base64") : undefined,
      verificationUrl: json.verificationUrl,
      failureReason: json.reason,
      raw: { ...json, certificatePdfBase64: undefined },
    };
  }

  async purchase(req: EStampRequest, idempotencyKey: string) {
    const { status, json } = await this.call("POST", "/v1/estamps", {
      state: req.stateCode,
      article: req.articleCode,
      documentDescription: req.descriptionOfDocument,
      propertyDescription: req.propertyDescription,
      considerationAmount: req.considerationPaise / 100,
      stampDutyAmount: req.stampDutyPaise / 100,
      firstParty: req.firstPartyName,
      secondParty: req.secondPartyName,
      stampDutyPaidBy: req.dutyPaidBy,
      purchasedBy: req.purchasedBy,
      fulfilment: req.fulfilmentMode,
      delivery: req.delivery,
    }, idempotencyKey);
    if (status >= 400) return { status: "FAILED" as const, failureReason: json.message ?? `HTTP ${status}`, raw: json };
    return this.map(json);
  }

  async status(ref: { providerRequestId?: string; idempotencyKey: string }) {
    const path = ref.providerRequestId
      ? `/v1/estamps/${encodeURIComponent(ref.providerRequestId)}`
      : `/v1/estamps?idempotencyKey=${encodeURIComponent(ref.idempotencyKey)}`;
    const { status, json } = await this.call("GET", path);
    if (status === 404) throw new EStampProviderError(this.name, false, "not found");
    return this.map(json);
  }
}

/**
 * MVP fallback for states without an API: queues the order for the ops team,
 * who buy at an ACC and upload the scanned certificate via the admin console
 * (EStampService.completeManually). SLA is shown to the user up front.
 */
export class ManualOpsProvider implements EStampProvider {
  readonly name = "MANUAL_OPS";
  readonly queue: { idempotencyKey: string; req: EStampRequest }[] = [];
  supports() {
    return true;
  }
  async purchase(req: EStampRequest, idempotencyKey: string): Promise<EStampResult> {
    if (!this.queue.some((q) => q.idempotencyKey === idempotencyKey)) this.queue.push({ idempotencyKey, req });
    return { status: "SUBMITTED", providerRequestId: `OPS-${idempotencyKey.slice(-8)}` };
  }
  async status(): Promise<EStampResult> {
    return { status: "SUBMITTED" };
  }
}

async function renderSandboxCertificate(req: EStampRequest, certificateNo: string, issuedAt: Date) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(0.13, 0.45, 0.25);
  page.drawRectangle({ x: 36, y: 380, width: 523, height: 420, borderColor: green, borderWidth: 2, color: rgb(0.95, 0.98, 0.95) });
  page.drawText("SANDBOX — NOT A VALID STAMP", { x: 150, y: 770, size: 16, font: bold, color: rgb(0.75, 0.1, 0.1) });
  page.drawText("e-Stamp Certificate (simulated)", { x: 60, y: 740, size: 14, font: bold, color: green });
  const rows: [string, string][] = [
    ["Certificate No.", certificateNo],
    ["Certificate Issued Date", issuedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC"],
    ["Account Reference", `${req.stateCode}-SBX-ACC-001`],
    ["Description of Document", `${req.articleCode} — ${req.descriptionOfDocument}`],
    ["Property Description", req.propertyDescription.length > 58 ? `${req.propertyDescription.slice(0, 55)}...` : req.propertyDescription],
    ["Consideration Price (Rs.)", formatInr(req.considerationPaise).replace("₹", "")],
    ["First Party", req.firstPartyName],
    ["Second Party", req.secondPartyName],
    ["Stamp Duty Paid By", req.dutyPaidBy],
    ["Stamp Duty Amount (Rs.)", formatInr(req.stampDutyPaise).replace("₹", "")],
    ["Purchased by", req.purchasedBy],
  ];
  rows.forEach(([k, v], i) => {
    const y = 700 - i * 26;
    page.drawText(k, { x: 60, y, size: 10, font: bold });
    page.drawText(v, { x: 230, y, size: 10, font });
  });
  return pdf.save();
}
