import type { ScheduleWarning } from "@/lib/schedule-warnings";

type T = (key: string, values?: Record<string, string | number>) => string;

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Human text for a scheduling warning. `t` is useTranslations("warnings") / getTranslations("warnings"). */
export function warningText(t: T, w: ScheduleWarning): string {
  const p = w.params;
  switch (w.type) {
    case "UNAVAILABLE":
      return p.reason === "hours" ? t("unavailableHours", { from: hhmm(Number(p.from)), to: hhmm(Number(p.to)) }) : t("unavailableDay");
    case "TIME_OFF":
      return t("timeOff");
    case "OVERLAP":
      return t("overlap");
    case "OVERTIME_RISK":
      return t(p.scope === "day" ? "overtimeDay" : "overtimeWeek", { hours: p.hours, threshold: p.threshold });
    case "SHORT_REST":
      return t("shortRest", { hours: p.hours, minimum: p.minimum });
    case "SPLIT_SHIFT":
      return t("splitShift", { hours: p.hours, maximum: p.maximum });
    case "UNDER_AGE":
      return t("underAge", { age: p.age, minimum: p.minimum });
  }
}
