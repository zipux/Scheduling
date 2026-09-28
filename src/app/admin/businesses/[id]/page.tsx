import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getBusinessForAdmin } from "@/server/platform/admin";
import { invitationDisplayStatus } from "@/server/services/invitations";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { BusinessStatusControls, ResendOwnerInvite } from "./controls";

export const dynamic = "force-dynamic";

export default async function AdminBusinessPage({ params }: PageProps<"/admin/businesses/[id]">) {
  const { id } = await params;
  const t = await getTranslations("admin");
  const biz = await getBusinessForAdmin(id);
  if (!biz) notFound();
  return (
    <>
      <PageHeader title={biz.name} description={`${biz.country}-${biz.region} · ${biz.timezone} · ${biz.currency}`} />
      <section className="mb-6 space-y-3">
        <h2 className="font-medium">{t("status")}</h2>
        <BusinessStatusControls
          businessId={biz.id}
          subscriptionStatus={biz.subscriptionStatus}
          suspended={!!biz.suspendedAt}
        />
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">{t("owners")}</h2>
        <ul className="divide-y rounded-lg border">
          {biz.memberships.map((m) => (
            <li key={m.id} className="px-4 py-3">
              {m.user.name} · <span className="text-muted-foreground">{m.user.email}</span>
            </li>
          ))}
          {biz.invitations
            .filter((i) => i.status !== "accepted")
            .map((i) => {
              const s = invitationDisplayStatus(i);
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-3" data-testid="owner-invitation">
                  <span className="min-w-0 flex-1">
                    {i.name} · <span className="text-muted-foreground">{i.email}</span>
                  </span>
                  <Badge variant={s === "delivery_failed" ? "destructive" : "outline"}>{t(`inviteStatus.${s}`)}</Badge>
                  {s !== "revoked" && <ResendOwnerInvite businessId={biz.id} invitationId={i.id} />}
                </li>
              );
            })}
        </ul>
      </section>
    </>
  );
}
