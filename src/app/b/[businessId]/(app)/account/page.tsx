import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { activeMemberships, requireBusinessPage } from "@/server/auth/context";
import { userHasPassword } from "@/server/auth/reauth";
import { PageHeader } from "@/components/app/page-header";
import { ChangePinForm } from "./change-pin-form";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("account") };
}

export default async function AccountPage({ params }: PageProps<"/b/[businessId]/account">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  const t = await getTranslations("account");
  const memberships = await activeMemberships(ctx.userId);
  return (
    <>
      <PageHeader title={t("title")} />
      <section className="mb-8 max-w-md space-y-3">
        <h2 className="font-medium">{t("changePin")}</h2>
        <p className="text-sm text-muted-foreground">{t("changePinHint", { business: ctx.business.name })}</p>
        <ChangePinForm businessId={businessId} hasPassword={await userHasPassword(ctx.userId)} />
      </section>
      <section className="max-w-md space-y-2">
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
    </>
  );
}
