import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatInTimeZone } from "date-fns-tz";
import { requireUser } from "@/server/auth/context";
import { myHoursAcrossBusinesses } from "@/server/auth/memberships";

export default async function AllMyHoursPage() {
  const user = await requireUser();
  const t = await getTranslations("clock");
  const entries = await myHoursAcrossBusinesses(user.id);
  const worked = (e: (typeof entries)[number]) => {
    if (!e.clockIn || !e.clockOut) return null;
    const breaks = e.breaks.reduce((n, b) => n + (b.endsAt ? b.endsAt.getTime() - b.startsAt.getTime() : 0), 0);
    return (e.clockOut.getTime() - e.clockIn.getTime() - breaks) / 3_600_000;
  };
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <Link href="/" className="inline-flex min-h-11 items-center text-sm underline">
        ← {t("back")}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{t("allMyHours")}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t("allMyHoursHint")}</p>
      <ul className="divide-y rounded-lg border text-sm" data-testid="all-my-hours">
        {entries.map((e) => {
          const tz = e.location.timezone;
          const h = worked(e);
          return (
            <li key={e.id} className="flex flex-wrap gap-2 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{e.businessName}</span>
                <span className="block tabular-nums text-muted-foreground">
                  {e.clockIn ? formatInTimeZone(e.clockIn, tz, "EEE d MMM HH:mm") : "—"} → {e.clockOut ? formatInTimeZone(e.clockOut, tz, "HH:mm") : t("open")} · {e.location.name}
                </span>
              </span>
              <span className="tabular-nums">{h === null ? "—" : `${h.toFixed(2)} h`}</span>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
