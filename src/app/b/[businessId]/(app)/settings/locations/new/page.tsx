import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { emptyLocation } from "@/lib/location-values";
import { timezones } from "@/lib/regions";
import { LocationForm } from "../location-form";

export default async function NewLocationPage({ params }: PageProps<"/b/[businessId]/settings/locations/new">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  if (!hasPermission(ctx, "business.settings")) notFound();
  const t = await getTranslations("settings.locations");
  return (
    <>
      <PageHeader title={t("new")} />
      <LocationForm businessId={businessId} initial={emptyLocation(ctx.business.timezone)} timezones={timezones()} />
    </>
  );
}
