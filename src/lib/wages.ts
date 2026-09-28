/**
 * Wage resolution (Spec §8). Pure; dates are "YYYY-MM-DD" calendar dates.
 *
 * - A position-specific wage beats the general wage for that position.
 * - Within a kind, the latest effectiveFrom on or before the date wins.
 * - Pay for a period uses the wage in force on the period's FIRST day, so a raise
 *   dated mid-period leaves the whole current period at the old rate (§8).
 */
export interface WageRow {
  rateCents: number;
  type: "hourly" | "salary";
  positionId: string | null;
  effectiveFrom: string; // YYYY-MM-DD
}

function latest(rows: WageRow[], date: string) {
  let best: WageRow | null = null;
  for (const r of rows) {
    if (r.effectiveFrom <= date && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
  }
  return best;
}

export function wageOn(rows: WageRow[], date: string, positionId?: string | null): WageRow | null {
  if (positionId) {
    const specific = latest(rows.filter((r) => r.positionId === positionId), date);
    if (specific) return specific;
  }
  return latest(rows.filter((r) => r.positionId === null), date);
}

export function wageForPeriod(rows: WageRow[], periodStart: string, positionId?: string | null): WageRow | null {
  return wageOn(rows, periodStart, positionId);
}

export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
