import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatInTimeZone } from "date-fns-tz";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { ActionButton } from "@/components/app/action-button";
import { Badge } from "@/components/ui/badge";
import { revokeKioskAction } from "./actions";

export default async function KiosksPage({ params }: PageProps<"/b/[businessId]/settings/kiosks">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  if (!hasPermission(ctx, "timeclock.edit")) notFound();
  const t = await getTranslations("settings.kiosks");
  const devices = await ctx.db.kioskDevice.findMany({ orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }] });
  const locations = new Map((await ctx.db.location.findMany()).map((l) => [l.id, l.name]));
  const fmt = (d: Date | null) => (d ? formatInTimeZone(d, ctx.business.timezone, "d MMM yyyy HH:mm") : t("never"));
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/kiosk/enrol" className="inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground md:h-9">
            {t("enrolThis")}
          </Link>
        }
      />
      {devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm" data-testid="kiosk-list">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{d.name}</span>
                <span className="block text-muted-foreground">
                  {locations.get(d.locationId)} · {t("lastSeen", { when: fmt(d.lastSeenAt) })}
                </span>
              </span>
              {d.revokedAt ? (
                <Badge variant="secondary">{t("revoked")}</Badge>
              ) : (
                <ActionButton action={revokeKioskAction} businessId={businessId} args={{ id: d.id }} label={t("revoke")} variant="destructive" success={t("revokedDone")} />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
