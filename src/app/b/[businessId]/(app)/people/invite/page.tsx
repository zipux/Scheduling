import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { InviteForm } from "./invite-form";

export default async function InvitePage({ params }: PageProps<"/b/[businessId]/people/invite">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  if (!hasPermission(ctx, "employees.invite")) notFound();
  const t = await getTranslations("people");
  const [roles, locations, positions] = await Promise.all([
    ctx.db.role.findMany({ orderBy: { rank: "asc" } }),
    ctx.db.location.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }),
    ctx.db.position.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }),
  ]);
  // Only roles junior to the inviter (Owner may invite anyone, including co-owners).
  const assignable = roles.filter((r) => ctx.actor.isOwner || (!r.isOwner && r.rank > ctx.actor.rank));
  return (
    <>
      <PageHeader title={t("inviteTitle")} description={t("inviteSubtitle")} />
      <InviteForm
        businessId={businessId}
        roles={assignable.map((r) => ({ id: r.id, name: r.name }))}
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
        positions={positions.map((p) => ({ id: p.id, name: p.name }))}
        canSetWage={hasPermission(ctx, "wages.edit")}
        currency={ctx.business.currency}
      />
    </>
  );
}
