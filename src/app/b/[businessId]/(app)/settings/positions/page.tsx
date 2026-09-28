import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { PositionsEditor } from "./positions-editor";

export default async function PositionsPage({ params }: PageProps<"/b/[businessId]/settings/positions">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  if (!hasPermission(ctx, "business.settings")) notFound();
  const t = await getTranslations("settings.positions");
  const positions = await ctx.db.position.findMany({
    orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
    include: { _count: { select: { memberships: true } } },
  });
  return (
    <>
      <PageHeader title={t("title")} description={t("description", { age: ctx.business.minorAgeThreshold })} />
      <PositionsEditor
        businessId={businessId}
        positions={positions.map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          requiresMinimumAge: p.requiresMinimumAge,
          archived: !!p.archivedAt,
          members: p._count.memberships,
        }))}
      />
    </>
  );
}
