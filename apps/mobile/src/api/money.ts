/** Indian digit grouping: last three digits, then groups of two (1,25,000). */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/**
 * Format integer paise as rupees, e.g. 12500000 -> "₹1,25,000" and 12550 -> "₹125.50".
 * Paise are shown only when non-zero. Does not rely on Intl (Hermes support varies).
 */
export function formatInr(paise: number): string {
  if (!Number.isFinite(paise)) return "₹–";
  const sign = paise < 0 ? "-" : "";
  const abs = Math.round(Math.abs(paise));
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  const frac = rem ? `.${String(rem).padStart(2, "0")}` : "";
  return `${sign}₹${groupIndian(String(rupees))}${frac}`;
}

/** "1,25,000.50" or "125000" (rupees, as typed) -> integer paise, or null when not a number. */
export function rupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Integer paise -> rupee string for an input box ("125000" or "125000.5"). */
export function paiseToRupeesInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return "";
  return String(paise / 100);
}
