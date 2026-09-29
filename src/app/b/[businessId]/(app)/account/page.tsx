import Link from "next/link";
import { Download } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { activeMemberships, requireBusinessPage } from "@/server/auth/context";
import { userHasPassword } from "@/server/auth/reauth";
import { PageHeader } from "@/components/app/page-header";
import { ChangePinForm } from "./change-pin-form";
import { WageHistory } from "@/components/app/wage-history";
import { listWages } from "@/server/services/wages";
import { myPreferences } from "@/server/services/notifications";
import { NotificationPrefs } from "./notification-prefs";
import { formatInTimeZone } from "date-fns-tz";
import { deletionRequestedAt } from "@/server/platform/account-deletion";
import { DeleteAccount } from "./delete-account";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("account") };
}

export default async function AccountPage({ params }: PageProps<"/b/[businessId]/account">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  const t = await getTranslations("account");
  const tn = await getTranslations("notifications");
  const memberships = await activeMemberships(ctx.userId);
  const deletionAt = await deletionRequestedAt(ctx.userId);
  return (
    <>
      <PageHeader title={t("title")} />
      <section className="mb-8 max-w-md space-y-3">
        <h2 className="font-medium">{t("changePin")}</h2>
        <p className="text-sm text-muted-foreground">{t("changePinHint", { business: ctx.business.name })}</p>
        <ChangePinForm businessId={businessId} hasPassword={await userHasPassword(ctx.userId)} />
      </section>
      <section className="mb-8 max-w-md space-y-2">
        <h2 className="font-medium">{t("myPay")}</h2>
        <WageHistory
          wages={await listWages(ctx, ctx.membership.id)}
          currency={ctx.business.currency}
          positions={new Map((await ctx.db.position.findMany()).map((p) => [p.id, p.name]))}
        />
      </section>
      <section className="mb-8 max-w-md space-y-2">
        <h2 className="font-medium">{tn("prefsTitle")}</h2>
        <p className="text-sm text-muted-foreground">{tn("prefsHint")}</p>
        <NotificationPrefs businessId={businessId} prefs={await myPreferences(ctx)} />
      </section>
      <section className="mb-8 max-w-md space-y-2">
        <h2 className="font-medium">{t("myBusinesses")}</h2>
        <ul className="divide-y rounded-lg border">
          {memberships.map((m) => (
            <li key={m.id}>
              <Link href={`/b/${m.businessId}`} className="flex min-h-12 items-center justify-between px-4 hover:bg-muted">
                <span>{m.business.name}</span>
                <span className="text-sm text-muted-foreground">{m.role.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="mb-8 max-w-md space-y-2">
        <h2 className="font-medium">{t("myData")}</h2>
        <p className="text-sm text-muted-foreground">{t("myDataHint")}</p>
        <a href="/api/me/export" download className="inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm hover:bg-muted" data-testid="export-my-data">
          <Download className="size-4" aria-hidden />
          {t("exportData")}
        </a>
      </section>
      <section className="max-w-md space-y-2">
        <h2 className="font-medium">{t("deleteAccount")}</h2>
        <p className="text-sm text-muted-foreground">{t("deleteAccountHint")}</p>
        <DeleteAccount requestedOn={deletionAt ? formatInTimeZone(deletionAt, ctx.business.timezone, "d MMM yyyy") : null} />
      </section>
    </>
  );
}
