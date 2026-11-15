// E-stamp handoff. LegalKart never buys the stamp: we tell the customer exactly
// what to buy, send them to their state's official portal, and optionally
// record the certificate number they bring back. See docs/SYSTEM-DESIGN.md.
//
// The portals have no public API, so nothing here talks to them. We cannot
// confirm a purchase; a certificate number is format-checked only, and the
// documents say so.
import { formatInr, type Paise } from "../money.ts";
import type { DocumentTemplate } from "../documents/template.ts";
import type { DutyQuote, Party, PartyRole, PincodeData, StampDetailField, StampDetails } from "../types.ts";

export interface EStampPortal {
  name: string;
  url: string;
  steps: string[];
  /** When known, the exact certificate number format. Otherwise a loose check applies. */
  certificatePattern?: RegExp;
  certificateExample?: string;
}

const SHCIL_STEPS = [
  "Open the SHCIL e-stamping portal and choose your state.",
  "Choose the online e-stamp option with self-print, and enter the details listed below exactly as shown.",
  "Pay the stamp duty on the portal (net banking or card).",
  "Download and print the e-stamp certificate. It becomes the first page of the agreement.",
  "Come back here and enter the certificate number, or skip and attach the certificate yourself.",
];

// Steps and formats must be confirmed with one real purchase per state before
// launch (docs/SYSTEM-DESIGN.md, "External integrations").
export const ESTAMP_PORTALS: Record<string, EStampPortal> = {
  DL: {
    name: "SHCIL e-Stamping (Stock Holding Corporation of India)",
    url: "https://www.shcilestamp.com/",
    steps: SHCIL_STEPS,
    certificatePattern: /^IN-DL\d{14}[A-Z]$/,
    certificateExample: "IN-DL12345678901234A",
  },
  KA: {
    name: "SHCIL e-Stamping (Stock Holding Corporation of India)",
    url: "https://www.shcilestamp.com/",
    steps: SHCIL_STEPS,
    certificatePattern: /^IN-KA\d{14}[A-Z]$/,
    certificateExample: "IN-KA12345678901234A",
  },
  HR: {
    name: "Haryana e-GRAS e-Stamp",
    url: "https://egrashry.nic.in/",
    steps: [
      "Open the Haryana e-GRAS portal and choose e-Stamp.",
      "Enter the details listed below exactly as shown.",
      "Pay the stamp duty online through one of the listed banks.",
      "Download and print the e-stamp. It becomes the first page of the agreement.",
      "Come back here and enter the stamp's certificate number, or skip and attach the e-stamp yourself.",
    ],
  },
};

export class HandoffError extends Error {
  constructor(public code: "NO_PORTAL" | "INVALID_CERTIFICATE", message: string, public details?: unknown) {
    super(message);
  }
}

export function portalFor(stateCode: string): EStampPortal {
  const p = ESTAMP_PORTALS[stateCode];
  if (!p) throw new HandoffError("NO_PORTAL", `No e-stamp portal configured for ${stateCode}`);
  return p;
}

/** Normalises and format-checks a certificate number. Throws INVALID_CERTIFICATE. */
export function normaliseCertificateNo(stateCode: string, raw: string): string {
  const value = raw.trim().toUpperCase().replace(/\s+/g, "");
  const portal = portalFor(stateCode);
  const ok = portal.certificatePattern ? portal.certificatePattern.test(value) : /^[A-Z0-9][A-Z0-9-]{5,39}$/.test(value);
  if (!ok) {
    throw new HandoffError("INVALID_CERTIFICATE", "That doesn't look like a certificate number for this state", {
      example: portal.certificateExample,
    });
  }
  return value;
}

const names = (parties: Party[], role: PartyRole) =>
  parties.filter((p) => p.role === role).map((p) => p.fullName).join(", ");

/** Rupees as typed into a portal form: digits only, no symbol or grouping (duty is whole rupees). */
const portalAmount = (p: Paise) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));

export function buildStampDetails(input: {
  template: DocumentTemplate;
  pincodeData: PincodeData;
  propertyAddress: string;
  parties: Party[];
  quote: DutyQuote;
}): StampDetails {
  const { template, pincodeData, parties, quote } = input;
  const e = template.eStamp;
  const portal = portalFor(pincodeData.stateCode);
  const dutyPaise = quote.estampAmountPaise;
  const fields: StampDetailField[] = [
    { key: "state", label: "State", value: pincodeData.stateName },
    { key: "article", label: "Article", value: e.articleCodes[pincodeData.stateCode] ?? e.articleCodes["*"] ?? "" },
    { key: "descriptionOfDocument", label: "Description of document", value: e.descriptionOfDocument },
    { key: "propertyDescription", label: "Property description", value: `${input.propertyAddress} - ${pincodeData.pincode}`.replace(/^ - /, "") },
    // A rent agreement has no sale consideration; the portals expect 0.
    { key: "considerationAmount", label: "Consideration amount (Rs)", value: "0" },
    { key: "stampDutyAmount", label: "Stamp duty amount (Rs)", value: portalAmount(dutyPaise) },
    { key: "firstParty", label: "First party", value: names(parties, e.firstPartyRole) },
    { key: "secondParty", label: "Second party", value: names(parties, e.secondPartyRole) },
    { key: "stampDutyPaidBy", label: "Stamp duty paid by", value: names(parties, e.dutyPaidByRole) },
  ];
  return {
    stateCode: pincodeData.stateCode,
    dutyPaise,
    lines: quote.lines.map((l) => ({
      chargeType: l.chargeType, amountPaise: l.amountPaise, explanation: l.explanation, articleRef: l.articleRef, payableAt: l.payableAt,
    })),
    portal: { name: portal.name, url: portal.url, steps: portal.steps },
    fields,
    disclaimer: `Buy an e-stamp for exactly ${formatInr(dutyPaise)}. A stamp for a lower amount leaves the agreement under-stamped. ${template.disclaimer.text}`,
    quotedAt: quote.quotedAt,
  };
}
