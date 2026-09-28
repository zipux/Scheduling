import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { canManagePerson } from "@/lib/permissions";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { MemberAdmin } from "./member-admin";
import { AssignmentsForm } from "./assignments-form";
import { WageForm } from "./wage-form";
import { WageHistory } from "@/components/app/wage-history";
import { canViewWage } from "@/lib/permissions";
import { listWages } from "@/server/services/wages";

export default async function MemberPage({ params }: PageProps<"/b/[businessId]/people/[membershipId]">) {
  const { businessId, membershipId } = await params;
  const ctx = await requireBusinessPage(businessId);
  if (!hasPermission(ctx, "employees.edit") && !hasPermission(ctx, "employees.invite")) notFound();
  const m = await ctx.db.membership.findUnique({
    where: { id: membershipId },
    include: {
      user: { select: { name: true, email: true } },
      role: true,
      profile: true,
      locations: { include: { location: true } },
      positions: { include: { position: true } },
    },
  });
  if (!m) notFound();
  const t = await getTranslations("people");
  // §10: addresses and DOB only for managers with employees.edit.
  const seePrivate = hasPermission(ctx, "employees.edit");
  const manageable = canManagePerson(ctx.actor, { membershipId: m.id, rank: m.role.rank }, "employees.edit");
  const roles = await ctx.db.role.findMany({ orderBy: { rank: "asc" } });
  const assignable = roles.filter((r) => ctx.actor.isOwner || (!r.isOwner && r.rank > ctx.actor.rank));
  const [allLocations, allPositions] = await Promise.all([
    ctx.db.location.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }),
    ctx.db.position.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }),
  ]);
  const showWages = canViewWage(ctx.actor, m.id);
  const wages = showWages ? await listWages(ctx, m.id) : [];
  const canEditWage =
    hasPermission(ctx, "wages.edit") && (m.id === ctx.membership.id ? ctx.actor.isOwner : canManagePerson(ctx.actor, { membershipId: m.id, rank: m.role.rank }, "wages.edit"));

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-3 gap-2 px-4 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="col-span-2 break-words">{value || "—"}</dd>
    </div>
  );

  return (
    <>
      <PageHeader
        title={m.displayName ?? m.user.name}
        description={m.role.name}
        actions={m.status === "deactivated" ? <Badge variant="outline">{t("deactivated")}</Badge> : undefined}
      />
      <dl className="mb-6 divide-y rounded-lg border">
        {row(t("email"), m.user.email)}
        {row(t("phone"), m.profile?.phone)}
        {seePrivate && row(t("dateOfBirth"), m.profile?.dateOfBirth?.toISOString().slice(0, 10))}
        {seePrivate && row(t("address"), m.profile?.address)}
        {seePrivate &&
          row(
            t("emergencyContact"),
            m.profile?.emergencyContactName &&
              `${m.profile.emergencyContactName} (${m.profile.emergencyContactRelation}) ${m.profile.emergencyContactPhone}`,
          )}
        {row(t("locations"), m.locations.map((l) => l.location.name).join(", "))}
        {row(t("positions"), m.positions.map((p) => p.position.name).join(", "))}
        {row(t("hireDate"), m.hireDate?.toISOString().slice(0, 10))}
        {m.accessRevokedAt && row(t("accessRevoked"), m.accessRevokedAt.toISOString().slice(0, 10))}
        {m.employmentEndedAt && row(t("employmentEnded"), m.employmentEndedAt.toISOString().slice(0, 10))}
        {row(t("pin"), m.profile?.pinHmac ? t("pinSet") : t("pinNotSet"))}
      </dl>
      {manageable && (
        <section className="mb-8 space-y-3">
          <h2 className="font-medium">{t("assignments")}</h2>
          <AssignmentsForm
            businessId={businessId}
            membershipId={m.id}
            locations={allLocations.map((l) => ({ id: l.id, name: l.name }))}
            positions={allPositions.map((p) => ({ id: p.id, name: p.name }))}
            locationIds={m.locations.map((l) => l.locationId)}
            positionIds={m.positions.map((p) => p.positionId)}
          />
        </section>
      )}
      {showWages && (
        <section className="mb-8 space-y-3">
          <h2 className="font-medium">{t("wages")}</h2>
          <WageHistory wages={wages} currency={ctx.business.currency} positions={new Map(allPositions.map((p) => [p.id, p.name]))} />
          {canEditWage && <WageForm businessId={businessId} membershipId={m.id} currency={ctx.business.currency} positions={allPositions.map((p) => ({ id: p.id, name: p.name }))} />}
        </section>
      )}
      {manageable && (
        <MemberAdmin
          businessId={businessId}
          membershipId={m.id}
          roleId={m.roleId}
          roles={assignable.map((r) => ({ id: r.id, name: r.name }))}
          deactivated={m.status === "deactivated"}
          hasPin={!!m.profile?.pinHmac}
        />
      )}
    </>
  );
}
