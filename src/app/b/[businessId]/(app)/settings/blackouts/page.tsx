import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { accessibleLocationIds, hasPermission, requireBusinessPage } from "@/server/auth/context";
import { upcomingBlackouts } from "@/server/services/requests/timeoff";
import { PageHeader } from "@/components/app/page-header";
import { ActionButton } from "@/components/app/action-button";
import { deleteBlackoutAction } from "../../requests/actions";
import { BlackoutForm } from "./blackout-form";

export default async function BlackoutsPage({ params }: PageProps<"/b/[businessId]/settings/blackouts">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  if (!hasPermission(ctx, "blackout.manage")) notFound();
  const t = await getTranslations("settings.blackouts");
  const [list, locIds] = await Promise.all([upcomingBlackouts(ctx), accessibleLocationIds(ctx)]);
  const locations = await ctx.db.location.findMany({ where: { id: { in: locIds } }, orderBy: { name: "asc" } });
  const nameOf = new Map(locations.map((l) => [l.id, l.name]));
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="max-w-lg space-y-4">
        <BlackoutForm businessId={businessId} locations={locations.map((l) => ({ id: l.id, name: l.name }))} canAll={hasPermission(ctx, "locations.scope_all")} />
        {list.length > 0 && (
          <ul className="divide-y rounded-lg border" data-testid="blackout-list">
            {list.map((b) => (
              <li key={b.id} className="flex items-center gap-2 px-4 py-3 text-sm">
                <span className="flex-1">
                  <span className="block font-medium">
                    {b.startDate.toISOString().slice(0, 10)} – {b.endDate.toISOString().slice(0, 10)}
                  </span>
                  <span className="block text-muted-foreground">
                    {b.locationId ? nameOf.get(b.locationId) ?? "—" : t("allLocations")} · {b.reason}
                  </span>
                </span>
                <ActionButton action={deleteBlackoutAction} businessId={businessId} args={{ id: b.id }} label={t("delete")} variant="ghost" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
