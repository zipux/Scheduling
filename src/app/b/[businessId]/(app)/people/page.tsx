import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { UserPlus, ChevronRight } from "lucide-react";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { invitationDisplayStatus } from "@/server/services/invitations";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { InvitationActions } from "./invitation-actions";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("people") };
}

export default async function PeoplePage({ params }: PageProps<"/b/[businessId]/people">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  const canInvite = hasPermission(ctx, "employees.invite");
  if (!canInvite && !hasPermission(ctx, "employees.edit")) notFound();
  const t = await getTranslations("people");

  const [members, invitations] = await Promise.all([
    ctx.db.membership.findMany({
      include: { user: { select: { name: true, email: true } }, role: true },
      orderBy: [{ status: "asc" }, { role: { rank: "asc" } }, { createdAt: "asc" }],
    }),
    canInvite
      ? ctx.db.invitation.findMany({ where: { status: { not: "accepted" } }, include: { role: true }, orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
  ]);
  const now = new Date();

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          canInvite && (
            <Link
              href={`/b/${businessId}/people/invite`}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground md:h-9"
            >
              <UserPlus className="size-4" aria-hidden />
              {t("invite")}
            </Link>
          )
        }
      />
      {invitations.length > 0 && (
        <section className="mb-6" aria-labelledby="inv-h">
          <h2 id="inv-h" className="mb-2 text-sm font-medium text-muted-foreground">
            {t("invitations")}
          </h2>
          <ul className="divide-y rounded-lg border" data-testid="invitation-list">
            {invitations.map((inv) => {
              const s = invitationDisplayStatus(inv, now);
              return (
                <li key={inv.id} className="space-y-2 px-4 py-3" data-testid="invitation-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{inv.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {inv.email} · {inv.role.name}
                      </span>
                    </span>
                    <Badge variant={s === "delivery_failed" ? "destructive" : s === "invited" ? "secondary" : "outline"}>
                      {t(`inviteStatus.${s}`)}
                    </Badge>
                  </div>
                  {s !== "revoked" && (
                    <InvitationActions businessId={businessId} invitationId={inv.id} email={inv.email} failed={s === "delivery_failed"} />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section aria-labelledby="mem-h">
        <h2 id="mem-h" className="mb-2 text-sm font-medium text-muted-foreground">
          {t("members", { count: members.length })}
        </h2>
        <ul className="divide-y rounded-lg border" data-testid="member-list">
          {members.map((m) => (
            <li key={m.id}>
              <Link href={`/b/${businessId}/people/${m.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-muted">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{m.displayName ?? m.user.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">{m.role.name}</span>
                </span>
                {m.status === "deactivated" && <Badge variant="outline">{t("deactivated")}</Badge>}
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
