/** "18.50" / "$1,234.5" → cents. Empty → null. Invalid → NaN. */
export function parseMoneyToCents(v: string): number | null {
  const s = v.trim().replace(/[$,\s]/g, "");
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

export function formatCents(cents: number, currency: string, locale = "en-CA"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}
