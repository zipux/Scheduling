/**
 * Overtime (§7.6.2). The order of operations is mandatory:
 *
 *   1. Compute DAILY overtime per work-day. Those seconds are CONSUMED.
 *   2. Sum only the remaining (non-consumed) seconds for the week and apply the
 *      weekly threshold to those.
 *   3. Where tiers overlap, the HIGHER multiplier applies once — never both.
 *
 * Hours are assigned to tiers chronologically: the seconds worked after the
 * threshold is crossed are the overtime seconds.
 */

export interface OvertimeRules {
  dailyThresholdHours: number | null;
  dailyMultiplier: number | null;
  dailySecondThresholdHours: number | null;
  dailySecondMultiplier: number | null;
  weeklyThresholdHours: number | null;
  weeklyMultiplier: number | null;
}

export interface WorkItem {
  entryId: string;
  workDay: string;
  start: Date;
  seconds: number;
  rateCents: number;
}

export interface Allocation extends WorkItem {
  regular: number;
  daily1: number;
  daily2: number;
  weekly: number;
}

export interface OvertimeResult {
  items: Allocation[];
  regularSeconds: number;
  /** Seconds and multiplier per overtime bucket (only buckets with time). */
  buckets: { tier: "daily1" | "daily2" | "weekly"; multiplier: number; seconds: number }[];
}

const H = 3600;

function tier1(rules: OvertimeRules) {
  return rules.dailyThresholdHours !== null && rules.dailyMultiplier !== null ? { t: Math.round(rules.dailyThresholdHours * H), m: rules.dailyMultiplier } : null;
}
function tier2(rules: OvertimeRules) {
  return rules.dailySecondThresholdHours !== null && rules.dailySecondMultiplier !== null
    ? { t: Math.round(rules.dailySecondThresholdHours * H), m: rules.dailySecondMultiplier }
    : null;
}

/** Allocates one overtime week's hourly work into regular / daily / weekly tiers. */
export function allocateWeek(items: WorkItem[], rules: OvertimeRules): OvertimeResult {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime());
  const alloc: Allocation[] = sorted.map((i) => ({ ...i, regular: 0, daily1: 0, daily2: 0, weekly: 0 }));
  const d1 = tier1(rules);
  const d2 = tier2(rules);

  // Step 1 — daily, per work-day, chronologically.
  const cumByDay = new Map<string, number>();
  for (const a of alloc) {
    let cum = cumByDay.get(a.workDay) ?? 0;
    let left = a.seconds;
    const take = (limit: number) => {
      const n = Math.max(0, Math.min(left, limit - cum));
      left -= n;
      cum += n;
      return n;
    };
    if (!d1) {
      a.regular = left;
      cum += left;
      left = 0;
    } else {
      a.regular = take(d1.t);
      if (d2) a.daily1 = take(d2.t);
      else a.daily1 = take(Number.POSITIVE_INFINITY);
      a.daily2 = left; // beyond the second threshold
      cum += left;
      left = 0;
    }
    cumByDay.set(a.workDay, cum);
  }

  // Step 2 — weekly, on the non-consumed (regular) seconds only.
  if (rules.weeklyThresholdHours !== null && rules.weeklyMultiplier !== null) {
    const wt = Math.round(rules.weeklyThresholdHours * H);
    let cum = 0;
    for (const a of alloc) {
      const fits = Math.max(0, Math.min(a.regular, wt - cum));
      const over = a.regular - fits;
      cum += a.regular;
      a.regular = fits;
      a.weekly = over;
    }
  }

  // Step 3 — the higher multiplier once: daily2 hours are also past threshold 1,
  // but are paid only at max(m1, m2).
  const m1 = d1?.m ?? 1;
  const m2 = Math.max(d2?.m ?? 1, m1);
  const sum = (k: "regular" | "daily1" | "daily2" | "weekly") => alloc.reduce((n, a) => n + a[k], 0);
  const buckets: OvertimeResult["buckets"] = [];
  if (sum("daily1")) buckets.push({ tier: "daily1", multiplier: m1, seconds: sum("daily1") });
  if (sum("daily2")) buckets.push({ tier: "daily2", multiplier: m2, seconds: sum("daily2") });
  if (sum("weekly")) buckets.push({ tier: "weekly", multiplier: rules.weeklyMultiplier ?? 1, seconds: sum("weekly") });
  return { items: alloc, regularSeconds: sum("regular"), buckets };
}

/** Pay for seconds at a rate and multiplier, in cents, rounded half-up once. */
export function payCents(seconds: number, rateCents: number, multiplier = 1): number {
  return Math.round((seconds * rateCents * multiplier) / H);
}
