/** Indian digit grouping: last three digits, then groups of two (1,25,000). */
export function groupIndian(digits: string): string {
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

const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function below100(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} hundred` : "", r ? below100(r) : ""].filter(Boolean).join(" ");
}

/**
 * Whole rupees in words with Indian units, e.g. 25000 -> "Twenty-five thousand rupees",
 * 325000 -> "Three lakh twenty-five thousand rupees". Returns "" for 0 or bad input.
 */
export function rupeesInWords(rupees: number): string {
  if (!Number.isFinite(rupees) || rupees < 1 || rupees >= 1e11) return "";
  let n = Math.floor(rupees);
  const parts: string[] = [];
  for (const [size, name] of [
    [1e7, "crore"],
    [1e5, "lakh"],
    [1e3, "thousand"],
  ] as const) {
    const q = Math.floor(n / size);
    if (q) parts.push(`${q >= 100 ? below1000(q) : below100(q)} ${name}`);
    n %= size;
  }
  if (n) parts.push(below1000(n));
  const s = `${parts.join(" ")} rupee${Math.floor(rupees) === 1 ? "" : "s"}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Rupees as typed (digits, optional ".dd") -> display with Indian grouping: "275000" -> "2,75,000". */
export function groupRupeesInput(raw: string): string {
  const [whole, frac] = raw.split(".");
  const grouped = whole ? groupIndian(whole.replace(/^0+(?=\d)/, "")) : "";
  return frac === undefined ? grouped : `${grouped || "0"}.${frac}`;
}

/** Keep only what a rupee amount can contain: digits and one "." with up to 2 decimals. */
export function cleanRupeesInput(text: string): string {
  const s = text.replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (dot === -1) return s;
  return `${s.slice(0, dot)}.${s.slice(dot + 1).replace(/\./g, "").slice(0, 2)}`;
}

/** Integer paise -> rupee string for an input box ("125000" or "125000.5"). */
export function paiseToRupeesInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return "";
  return String(paise / 100);
}
