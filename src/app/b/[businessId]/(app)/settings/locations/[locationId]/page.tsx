import { notFound } from "next/navigation";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { timezones } from "@/lib/regions";
import { LocationForm } from "../location-form";

export default async function EditLocationPage({ params }: PageProps<"/b/[businessId]/settings/locations/[locationId]">) {
  const { businessId, locationId } = await params;
  const ctx = await requireBusinessPage(businessId);
  if (!hasPermission(ctx, "business.settings")) notFound();
  const l = await ctx.db.location.findUnique({ where: { id: locationId } });
  if (!l) notFound();
  return (
    <>
      <PageHeader title={l.name} description={l.address ?? undefined} />
      <LocationForm
        businessId={businessId}
        id={l.id}
        archived={!!l.archivedAt}
        timezones={timezones()}
        initial={{
          name: l.name,
          address: l.address ?? "",
          timezone: l.timezone,
          lat: l.lat === null ? "" : String(l.lat),
          lng: l.lng === null ? "" : String(l.lng),
          radiusM: String(l.radiusM),
          geofenceMode: l.geofenceMode,
          isTemporary: l.isTemporary,
        }}
      />
    </>
  );
}
