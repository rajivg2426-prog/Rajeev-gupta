import { formatInr } from "../api/money";
import type { AgreementBundle } from "../api/types";

/** Title and subtitle for a document, from whatever the draft has so far. */
export function describeAgreement({ document: doc, parties }: AgreementBundle) {
  const address = String(doc.formData?.property?.address ?? "").trim();
  const rent = doc.formData?.terms?.monthlyRent;
  const tenants = parties.filter((p) => p.role === "TENANT").map((p) => p.fullName);
  const title = address || `Rent agreement ${doc.referenceNo}`;
  const rentText = typeof rent === "number" ? `${formatInr(rent)}/month` : "";
  const subtitle = tenants.length
    ? [`Tenant: ${tenants.join(", ")}`, rentText].filter(Boolean).join(" · ")
    : [doc.propertyPincode ? `Pincode ${doc.propertyPincode}` : "", "no tenant yet"].filter(Boolean).join(" · ");
  return { title, subtitle, tenants };
}

/** "+91 98110 42317" from E.164. */
export function formatPhone(e164: string): string {
  const d = e164.replace(/^\+91/, "").replace(/\D/g, "");
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : e164;
}
