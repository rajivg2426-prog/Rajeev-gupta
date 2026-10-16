// OTP delivery providers. Each one only delivers a code — generation,
// hashing, expiry and attempt counting live in OtpService.
//
// India-specific rules baked in here:
//  * SMS must use a TRAI DLT-registered entity, header (sender id) and content
//    template; the text sent must match the registered template exactly.
//  * WhatsApp OTPs must use a Meta-approved AUTHENTICATION template.
//  * Android SMS Retriever auto-read needs the 11-char app hash at the end.
import type { VerificationChannel } from "../types.ts";

export interface OtpMessage {
  phoneE164: string;      // +91XXXXXXXXXX
  otp: string;
  ttlMinutes: number;
  documentLabel: string;  // "Rent Agreement"
}

export interface OtpProvider {
  readonly name: string;
  readonly channel: VerificationChannel;
  send(msg: OtpMessage): Promise<{ providerMessageId: string; dltTemplateId?: string }>;
}

export class ProviderError extends Error {
  constructor(public provider: string, public retryable: boolean, message: string) {
    super(message);
  }
}

type Fetch = typeof fetch;

/**
 * MSG91 Flow API. DLT template registered as (example):
 *   "##otp## is your OTP to confirm your mobile number for a ##docname## on LegalKart.
 *    Valid for ##ttl## minutes. Do not share it with anyone. -LGLKRT ##apphash##"
 * Check the request/response shape against MSG91's current docs before go-live.
 */
export class Msg91SmsProvider implements OtpProvider {
  readonly name = "MSG91";
  readonly channel = "SMS" as const;
  constructor(
    private cfg: { authKey: string; flowTemplateId: string; dltTemplateId: string; androidAppHash: string },
    private http: Fetch = fetch,
  ) {}

  async send(msg: OtpMessage) {
    const res = await this.http("https://control.msg91.com/api/v5/flow", {
      method: "POST",
      headers: { authkey: this.cfg.authKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        template_id: this.cfg.flowTemplateId,
        short_url: "0",
        recipients: [{
          mobiles: msg.phoneE164.replace("+", ""),
          otp: msg.otp,
          docname: msg.documentLabel,
          ttl: String(msg.ttlMinutes),
          apphash: this.cfg.androidAppHash,
        }],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
    if (!res.ok || body.type !== "success") {
      throw new ProviderError(this.name, res.status >= 500 || res.status === 429, `MSG91 ${res.status}: ${body.message ?? "unknown"}`);
    }
    return { providerMessageId: String(body.message), dltTemplateId: this.cfg.dltTemplateId };
  }
}

/** WhatsApp Business Cloud API (Meta) with a copy-code AUTHENTICATION template. */
export class MetaWhatsAppProvider implements OtpProvider {
  readonly name = "META_WA";
  readonly channel = "WHATSAPP" as const;
  constructor(
    private cfg: { accessToken: string; phoneNumberId: string; templateName: string; graphVersion: string },
    private http: Fetch = fetch,
  ) {}

  async send(msg: OtpMessage) {
    const url = `https://graph.facebook.com/${this.cfg.graphVersion}/${this.cfg.phoneNumberId}/messages`;
    const res = await this.http(url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.cfg.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msg.phoneE164.replace("+", ""),
        type: "template",
        template: {
          name: this.cfg.templateName,
          language: { code: "en" },
          components: [
            { type: "body", parameters: [{ type: "text", text: msg.otp }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: msg.otp }] },
          ],
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string } };
    if (!res.ok || !body.messages?.[0]) {
      throw new ProviderError(this.name, res.status >= 500 || res.status === 429, `WhatsApp ${res.status}: ${body.error?.message ?? "unknown"}`);
    }
    return { providerMessageId: body.messages[0].id };
  }
}

/** Dev/test provider: keeps the last code per number instead of sending it. */
export class ConsoleOtpProvider implements OtpProvider {
  readonly name: string;
  readonly outbox = new Map<string, string>();
  constructor(readonly channel: VerificationChannel = "SMS", private quiet = true) {
    this.name = `CONSOLE_${channel}`;
  }
  async send(msg: OtpMessage) {
    this.outbox.set(msg.phoneE164, msg.otp);
    if (!this.quiet) console.log(`[otp:${this.channel}] ${msg.phoneE164} → ${msg.otp}`);
    return { providerMessageId: `console-${Date.now()}` };
  }
}
