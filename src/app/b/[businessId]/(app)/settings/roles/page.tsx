import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { PERMISSIONS, can, parsePermissions } from "@/lib/permissions";
import { PageHeader } from "@/components/app/page-header";
import { RolesEditor } from "./roles-editor";

export default async function RolesPage({ params }: PageProps<"/b/[businessId]/settings/roles">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  if (!hasPermission(ctx, "roles.manage")) notFound();
  const t = await getTranslations("settings.roles");
  const roles = await ctx.db.role.findMany({
    orderBy: [{ rank: "asc" }, { name: "asc" }],
    include: { _count: { select: { memberships: true } } },
  });
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <RolesEditor
        businessId={businessId}
        actorRank={ctx.actor.isOwner ? 0 : ctx.actor.rank}
        grantable={PERMISSIONS.filter((p) => can(ctx.actor, p))}
        roles={roles.map((r) => ({
          id: r.id,
          name: r.name,
          rank: r.rank,
          isOwner: r.isOwner,
          members: r._count.memberships,
          permissions: r.isOwner ? [...PERMISSIONS] : parsePermissions(r.permissions),
        }))}
      />
    </>
  );
}
