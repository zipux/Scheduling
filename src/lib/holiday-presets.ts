/**
 * Statutory holiday presets per province (§7.6.4). A starting point the owner
 * reviews on the Holidays screen — not a statement of the law.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** nth (1-based) weekday (0=Sun) of a month. */
function nthWeekday(y: number, m: number, weekday: number, n: number) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return key(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}

/** Monday on or before May 24 (Victoria Day). */
function victoriaDay(y: number) {
  const d = new Date(Date.UTC(y, 4, 24));
  d.setUTCDate(24 - ((d.getUTCDay() + 6) % 7));
  return key(y, 5, d.getUTCDate());
}

/** Gregorian Easter Sunday (anonymous algorithm). */
export function easterSunday(y: number) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return key(y, month, day);
}

function goodFriday(y: number) {
  const d = new Date(`${easterSunday(y)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 2);
  return d.toISOString().slice(0, 10);
}

export interface HolidayPreset {
  date: string;
  name: string;
}

export function holidaysFor(country: string, region: string, year: number): HolidayPreset[] {
  if (country !== "CA") return [];
  const common: HolidayPreset[] = [
    { date: key(year, 1, 1), name: "New Year's Day" },
    { date: goodFriday(year), name: "Good Friday" },
    { date: key(year, 7, 1), name: "Canada Day" },
    { date: nthWeekday(year, 9, 1, 1), name: "Labour Day" },
    { date: key(year, 12, 25), name: "Christmas Day" },
  ];
  const extra: Record<string, HolidayPreset[]> = {
    ON: [
      { date: nthWeekday(year, 2, 1, 3), name: "Family Day" },
      { date: victoriaDay(year), name: "Victoria Day" },
      { date: nthWeekday(year, 10, 1, 2), name: "Thanksgiving" },
      { date: key(year, 12, 26), name: "Boxing Day" },
    ],
    BC: [
      { date: nthWeekday(year, 2, 1, 3), name: "Family Day" },
      { date: victoriaDay(year), name: "Victoria Day" },
      { date: nthWeekday(year, 8, 1, 1), name: "British Columbia Day" },
      { date: key(year, 9, 30), name: "National Day for Truth and Reconciliation" },
      { date: nthWeekday(year, 10, 1, 2), name: "Thanksgiving" },
      { date: key(year, 11, 11), name: "Remembrance Day" },
    ],
    AB: [
      { date: nthWeekday(year, 2, 1, 3), name: "Family Day" },
      { date: victoriaDay(year), name: "Victoria Day" },
      { date: nthWeekday(year, 10, 1, 2), name: "Thanksgiving" },
      { date: key(year, 11, 11), name: "Remembrance Day" },
    ],
    QC: [
      { date: victoriaDay(year), name: "National Patriots' Day" },
      { date: key(year, 6, 24), name: "Fête nationale" },
      { date: nthWeekday(year, 10, 1, 2), name: "Thanksgiving" },
    ],
  };
  return [...common, ...(extra[region] ?? [])].sort((a, b) => a.date.localeCompare(b.date));
}
