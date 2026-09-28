/**
 * Wage resolution (Spec §8). Pure; dates are "YYYY-MM-DD" calendar dates.
 *
 * - A position-specific wage beats the general wage for that position.
 * - Within a kind, the latest effectiveFrom on or before the date wins.
 * - Pay uses the wage in force on the work-day each hour was worked (`wageOn`), so a
 *   raise effective mid-period applies from its effective date. Approved periods never
 *   change: their numbers are a snapshot, and a wage can't be back-dated into one.
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

export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
