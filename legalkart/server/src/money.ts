// Money is always integer paise. Never use floats for amounts.

export type Paise = number;

export const rupees = (r: number): Paise => Math.round(r * 100);

/** Round UP to the nearest `unit` paise (stamp duty is never rounded down). */
export function ceilTo(amount: Paise, unit: Paise): Paise {
  if (unit <= 1) return Math.ceil(amount);
  return Math.ceil(amount / unit) * unit;
}

/** amount × bps / 10_000, rounded up to the paisa. */
export function applyBps(amount: Paise, bps: number): Paise {
  return Math.ceil((amount * bps) / 10_000);
}

/** "₹1,25,000" — Indian digit grouping. */
export function formatInr(amount: Paise): string {
  const r = Math.floor(amount / 100);
  const p = amount % 100;
  const s = String(r);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `₹${rest ? `${rest},${last3}` : last3}${p ? `.${String(p).padStart(2, "0")}` : ""}`;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven",
  "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? below100(r) : ""].filter(Boolean).join(" ");
}

/** Indian numbering system: 12,34,56,789 → "Twelve Crore Thirty-Four Lakh ..." */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`numberToWords: ${n}`);
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  const lakh = Math.floor((n % 1e7) / 1e5);
  const thousand = Math.floor((n % 1e5) / 1e3);
  const rest = n % 1e3;
  if (crore) parts.push(`${crore >= 100 ? numberToWords(crore) : below100(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(" ");
}

/** "₹25,000/- (Rupees Twenty-Five Thousand Only)" — the form used in Indian deeds. */
export function inrInWords(amount: Paise): string {
  const r = Math.floor(amount / 100);
  const p = amount % 100;
  const words = `Rupees ${numberToWords(r)}${p ? ` and ${below100(p)} Paise` : ""} Only`;
  return `${formatInr(amount)}/- (${words})`;
}
