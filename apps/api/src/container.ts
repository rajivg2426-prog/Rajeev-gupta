// Wires services from environment. With no provider credentials set, the app
// runs fully in sandbox mode (OTPs printed to the console).
import { loadTemplate } from "./documents/template.ts";
import { DEFAULT_OTP_CONFIG, OtpService } from "./otp/otpService.ts";
import { ConsoleOtpProvider, MetaWhatsAppProvider, Msg91SmsProvider, type OtpProvider } from "./otp/providers.ts";
import { PincodeService } from "./pincode/pincodeService.ts";
import { RentAgreementService } from "./rentAgreement/rentAgreementService.ts";
import { MemoryStore, sampleReferenceData } from "./store.ts";
import type { VerificationChannel } from "./types.ts";

export function buildContainer(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  const store = new MemoryStore(sampleReferenceData());

  const otpProviders: Partial<Record<VerificationChannel, OtpProvider>> = {
    SMS: env.MSG91_AUTH_KEY
      ? new Msg91SmsProvider({
          authKey: env.MSG91_AUTH_KEY,
          flowTemplateId: env.MSG91_FLOW_TEMPLATE_ID ?? "",
          dltTemplateId: env.DLT_TEMPLATE_ID ?? "",
          androidAppHash: env.ANDROID_SMS_APP_HASH ?? "",
        })
      : new ConsoleOtpProvider("SMS", false),
    WHATSAPP: env.WA_ACCESS_TOKEN
      ? new MetaWhatsAppProvider({
          accessToken: env.WA_ACCESS_TOKEN,
          phoneNumberId: env.WA_PHONE_NUMBER_ID ?? "",
          templateName: env.WA_OTP_TEMPLATE ?? "legalkart_otp",
          graphVersion: env.WA_GRAPH_VERSION ?? "v21.0",
        })
      : new ConsoleOtpProvider("WHATSAPP", false),
  };

  if (production && !env.OTP_PEPPER) throw new Error("OTP_PEPPER is required in production");
  const otp = new OtpService(store, otpProviders, { ...DEFAULT_OTP_CONFIG, pepper: env.OTP_PEPPER ?? "dev-only-pepper" });

  const template = loadTemplate("rent-agreement.residential.json");
  const pincodes = new PincodeService(store);
  const rent = new RentAgreementService(store, template, pincodes, otp, {
    requireVerifiedRates: production,
    verifyBaseUrl: env.VERIFY_BASE_URL ?? "https://verify.legalkart.example",
  });

  return { store, otp, otpProviders, template, rent, pincodes };
}

export type Container = ReturnType<typeof buildContainer>;
