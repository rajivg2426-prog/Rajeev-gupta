// Party mobile verification via OTP (SMS / WhatsApp).
//
// Security properties:
//  * OTP from crypto.randomInt; only HMAC-SHA256(pepper, verificationId:otp) is stored.
//  * Constant-time compare; 5 attempts then LOCKED; 5-minute expiry.
//  * Resend cooldown + cap, and a per-phone hourly cap to stop SMS pumping.
//  * One live challenge per party; a new one supersedes (expires) the old.
//  * Changing a party's phone number clears their verification (see RentAgreementService).
import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { MemoryStore } from "../store.ts";
import type { Party, PartyVerification, VerificationChannel } from "../types.ts";
import { ProviderError, type OtpProvider } from "./providers.ts";

export interface OtpConfig {
  pepper: string;
  length: number;
  ttlSeconds: number;
  maxAttempts: number;
  resendCooldownSeconds: number;
  maxResends: number;
  maxSendsPerPhonePerHour: number;
}

export const DEFAULT_OTP_CONFIG: Omit<OtpConfig, "pepper"> = {
  length: 6,
  ttlSeconds: 300,
  maxAttempts: 5,
  resendCooldownSeconds: 30,
  maxResends: 3,
  maxSendsPerPhonePerHour: 5,
};

export class OtpError extends Error {
  constructor(
    public code: "RATE_LIMITED" | "RESEND_TOO_SOON" | "NOT_FOUND" | "EXPIRED" | "LOCKED" | "INVALID_OTP" | "ALREADY_VERIFIED" | "DELIVERY_FAILED",
    message: string,
    public meta: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export class OtpService {
  constructor(
    private store: MemoryStore,
    private providers: Partial<Record<VerificationChannel, OtpProvider>>,
    private cfg: OtpConfig,
    private now: () => Date = () => new Date(),
  ) {}

  private hmac(verificationId: string, otp: string) {
    return createHmac("sha256", this.cfg.pepper).update(`${verificationId}:${otp}`).digest("hex");
  }

  private generateOtp() {
    return String(randomInt(0, 10 ** this.cfg.length)).padStart(this.cfg.length, "0");
  }

  async start(party: Party, channel: VerificationChannel, opts: { documentLabel: string; consentTextVersion: string }) {
    if (party.isVerified) throw new OtpError("ALREADY_VERIFIED", "This party is already verified");
    const now = this.now();

    const lastHour = await this.store.verificationsForPhoneSince(party.phoneE164, new Date(now.getTime() - 3_600_000));
    if (lastHour.length >= this.cfg.maxSendsPerPhonePerHour) {
      throw new OtpError("RATE_LIMITED", "Too many OTP requests for this number. Try again later.");
    }

    const live = await this.store.liveVerificationFor(party.id);
    let resendCount = 0;
    if (live) {
      const nextAllowed = new Date(live.createdAt.getTime() + this.cfg.resendCooldownSeconds * 1000);
      if (now < nextAllowed) {
        throw new OtpError("RESEND_TOO_SOON", "Please wait before requesting another OTP", { retryAt: nextAllowed.toISOString() });
      }
      if (live.resendCount >= this.cfg.maxResends) {
        throw new OtpError("RATE_LIMITED", "Resend limit reached for this verification");
      }
      resendCount = live.resendCount + 1;
      live.status = "EXPIRED"; // superseded
    }

    const id = randomUUID();
    const otp = this.generateOtp();
    const record: PartyVerification = {
      id,
      partyId: party.id,
      documentId: party.documentId,
      phoneE164: party.phoneE164,
      channel,
      status: "PENDING",
      otpHmac: this.hmac(id, otp),
      attempts: 0,
      maxAttempts: this.cfg.maxAttempts,
      resendCount,
      provider: "",
      providerMessageId: null,
      expiresAt: new Date(now.getTime() + this.cfg.ttlSeconds * 1000),
      verifiedAt: null,
      consentTextVersion: opts.consentTextVersion,
      createdAt: now,
    };
    this.store.verifications.set(id, record);

    // WhatsApp first if asked, falling back to SMS on a provider failure.
    const order: VerificationChannel[] = channel === "WHATSAPP" ? ["WHATSAPP", "SMS"] : [channel];
    let lastError: unknown;
    for (const ch of order) {
      const provider = this.providers[ch];
      if (!provider) continue;
      try {
        const sent = await provider.send({
          phoneE164: party.phoneE164,
          otp,
          ttlMinutes: Math.round(this.cfg.ttlSeconds / 60),
          documentLabel: opts.documentLabel,
        });
        Object.assign(record, { status: "SENT", channel: ch, provider: provider.name, providerMessageId: sent.providerMessageId });
        this.store.log("system", "OTP_SENT", party.id, { channel: ch, provider: provider.name, verificationId: id });
        return { verificationId: id, channel: ch, expiresAt: record.expiresAt, phoneMasked: maskPhone(party.phoneE164) };
      } catch (err) {
        lastError = err;
        this.store.log("system", "OTP_PROVIDER_ERROR", party.id, {
          channel: ch,
          retryable: err instanceof ProviderError ? err.retryable : true,
          error: String(err),
        });
      }
    }
    record.status = "FAILED";
    throw new OtpError("DELIVERY_FAILED", "Could not deliver the OTP. Please try another channel.", { cause: String(lastError) });
  }

  async verify(verificationId: string, otp: string) {
    const v = this.store.verifications.get(verificationId);
    if (!v) throw new OtpError("NOT_FOUND", "Verification not found");
    if (v.status === "VERIFIED") throw new OtpError("ALREADY_VERIFIED", "Already verified");
    if (v.status === "LOCKED") throw new OtpError("LOCKED", "Too many wrong attempts. Request a new OTP.");
    if (v.status !== "SENT") throw new OtpError("EXPIRED", "This OTP is no longer valid. Request a new one.");
    if (this.now() > v.expiresAt) {
      v.status = "EXPIRED";
      throw new OtpError("EXPIRED", "OTP expired. Request a new one.");
    }

    v.attempts += 1;
    const expected = Buffer.from(v.otpHmac, "hex");
    const actual = Buffer.from(this.hmac(v.id, String(otp).trim()), "hex");
    if (!timingSafeEqual(expected, actual)) {
      if (v.attempts >= v.maxAttempts) v.status = "LOCKED";
      this.store.log("system", "OTP_FAILED", v.partyId, { verificationId: v.id, attempts: v.attempts });
      throw new OtpError(v.status === "LOCKED" ? "LOCKED" : "INVALID_OTP", "Incorrect OTP", {
        attemptsLeft: Math.max(0, v.maxAttempts - v.attempts),
      });
    }

    const party = this.store.parties.get(v.partyId);
    // Guard against a phone edit between send and verify.
    if (!party || party.phoneE164 !== v.phoneE164) {
      v.status = "EXPIRED";
      throw new OtpError("EXPIRED", "The party's phone number changed. Request a new OTP.");
    }
    const at = this.now();
    v.status = "VERIFIED";
    v.verifiedAt = at;
    party.isVerified = true;
    party.verifiedAt = at;
    this.store.log(`party:${party.id}`, "PARTY_VERIFIED", party.id, { verificationId: v.id, channel: v.channel, consent: v.consentTextVersion });
    return { partyId: party.id, verifiedAt: at, channel: v.channel };
  }
}

export function maskPhone(e164: string) {
  return `+91******${e164.slice(-4)}`;
}
