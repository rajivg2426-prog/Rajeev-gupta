// Razorpay: Orders API + checkout signature + webhook signature.
// Government stamp duty is a pass-through and is kept separate from the
// taxable service/vendor fee; GST applies only to the latter.
import { createHmac, timingSafeEqual } from "node:crypto";
import { applyBps, type Paise } from "../money.ts";

export interface PriceBreakdown {
  govtDutyPaise: Paise;
  vendorFeePaise: Paise;
  serviceFeePaise: Paise;
  gstPaise: Paise;
  totalPaise: Paise;
}

export const GST_BPS = 1800; // 18% on services

export function priceOrder(estampDutyPaise: Paise, fees: { vendorFeePaise: Paise; serviceFeePaise: Paise }): PriceBreakdown {
  const gstPaise = applyBps(fees.vendorFeePaise + fees.serviceFeePaise, GST_BPS);
  return {
    govtDutyPaise: estampDutyPaise,
    vendorFeePaise: fees.vendorFeePaise,
    serviceFeePaise: fees.serviceFeePaise,
    gstPaise,
    totalPaise: estampDutyPaise + fees.vendorFeePaise + fees.serviceFeePaise + gstPaise,
  };
}

export interface PaymentGateway {
  readonly name: "RAZORPAY";
  createOrder(input: { amountPaise: Paise; receipt: string; notes: Record<string, string> }): Promise<{ orderId: string }>;
  verifyCheckout(input: { orderId: string; paymentId: string; signature: string }): boolean;
  verifyWebhook(rawBody: string, signature: string): boolean;
}

const safeEqualHex = (a: string, b: string) => {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
};

export class RazorpayGateway implements PaymentGateway {
  readonly name = "RAZORPAY" as const;
  constructor(private cfg: { keyId: string; keySecret: string; webhookSecret: string }, private http: typeof fetch = fetch) {}

  async createOrder(input: { amountPaise: Paise; receipt: string; notes: Record<string, string> }) {
    const res = await this.http("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${this.cfg.keyId}:${this.cfg.keySecret}`).toString("base64")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ amount: input.amountPaise, currency: "INR", receipt: input.receipt, notes: input.notes }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as { id?: string; error?: { description: string } };
    if (!res.ok || !json.id) throw new Error(`Razorpay order failed: ${json.error?.description ?? res.status}`);
    return { orderId: json.id };
  }

  /** Signature returned to the app by Razorpay Checkout on success. */
  verifyCheckout({ orderId, paymentId, signature }: { orderId: string; paymentId: string; signature: string }) {
    const expected = createHmac("sha256", this.cfg.keySecret).update(`${orderId}|${paymentId}`).digest("hex");
    return safeEqualHex(expected, signature);
  }

  /** X-Razorpay-Signature over the RAW request body. */
  verifyWebhook(rawBody: string, signature: string) {
    const expected = createHmac("sha256", this.cfg.webhookSecret).update(rawBody).digest("hex");
    return safeEqualHex(expected, signature);
  }
}

/** Test double that signs exactly like Razorpay, using a local secret. */
export class FakeRazorpayGateway extends RazorpayGateway {
  private seq = 0;
  constructor(public secret = "test_secret") {
    super({ keyId: "rzp_test_x", keySecret: secret, webhookSecret: secret });
  }
  override async createOrder() {
    return { orderId: `order_TEST${String(++this.seq).padStart(6, "0")}` };
  }
  sign(orderId: string, paymentId: string) {
    return createHmac("sha256", this.secret).update(`${orderId}|${paymentId}`).digest("hex");
  }
}
