import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronRight, MapPin, Plus } from "lucide-react";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";

export default async function LocationsPage({ params }: PageProps<"/b/[businessId]/settings/locations">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  if (!hasPermission(ctx, "business.settings")) notFound();
  const t = await getTranslations("settings.locations");
  const tl = await getTranslations("location");
  const locations = await ctx.db.location.findMany({ orderBy: [{ archivedAt: "asc" }, { name: "asc" }] });
  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          <Link
            href={`/b/${businessId}/settings/locations/new`}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground md:h-9"
          >
            <Plus className="size-4" aria-hidden />
            {t("new")}
          </Link>
        }
      />
      <ul className="divide-y rounded-lg border" data-testid="location-list">
        {locations.map((l) => (
          <li key={l.id}>
            <Link href={`/b/${businessId}/settings/locations/${l.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-muted">
              <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{l.name}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {tl(`mode.${l.geofenceMode}`)}
                  {l.geofenceMode !== "off" && ` · ${l.radiusM} m`}
                  {" · "}
                  {l.timezone}
                </span>
              </span>
              {l.isTemporary && <Badge variant="outline">{t("temporary")}</Badge>}
              {l.archivedAt && <Badge variant="secondary">{t("archived")}</Badge>}
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
