import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { listBusinesses } from "@/server/platform/admin";
import { listDeletionRequests } from "@/server/platform/account-deletion";
import { invitationDisplayStatus } from "@/server/services/invitations";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const t = await getTranslations("admin");
  const [businesses, deletions] = await Promise.all([listBusinesses(), listDeletionRequests()]);
  return (
    <>
      <PageHeader
        title={t("businesses")}
        actions={
          <Link
            href="/admin/new"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground md:h-9"
          >
            <Plus className="size-4" aria-hidden />
            {t("createBusiness")}
          </Link>
        }
      />
      {businesses.length === 0 ? (
        <EmptyState title={t("noBusinesses")} />
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="business-list">
          {businesses.map((b) => {
            const inv = b.invitations[0];
            const invStatus = inv ? invitationDisplayStatus(inv) : null;
            return (
              <li key={b.id}>
                <Link href={`/admin/businesses/${b.id}`} className="flex flex-wrap items-center gap-2 px-4 py-3 hover:bg-muted">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{b.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {b.country}-{b.region} · {t("members", { count: b._count.memberships })}
                    </span>
                  </span>
                  {b.suspendedAt && <Badge variant="destructive">{t("suspended")}</Badge>}
                  <Badge variant="secondary">{t(`subscription.${b.subscriptionStatus}`)}</Badge>
                  {invStatus && invStatus !== "accepted" && (
                    <Badge variant={invStatus === "delivery_failed" ? "destructive" : "outline"}>
                      {t("ownerInvite")}: {t(`inviteStatus.${invStatus}`)}
                    </Badge>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {deletions.length > 0 && (
        <section className="mt-8 space-y-2" data-testid="deletion-requests">
          <h2 className="font-medium">{t("deletionRequests")}</h2>
          <p className="text-sm text-muted-foreground">{t("deletionRequestsHint")}</p>
          <ul className="divide-y rounded-lg border">
            {deletions.map((u) => (
              <li key={u.id} className="px-4 py-3">
                <span className="block font-medium">
                  {u.name} · {u.email}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {t("requestedOn", { date: formatInTimeZone(u.deletionRequestedAt!, "UTC", "d MMM yyyy") })}
                  {u.memberships.length > 0 && ` · ${u.memberships.map((m) => m.business.name).join(", ")}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
