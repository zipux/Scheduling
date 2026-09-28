import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { activeMemberships, hasPermission, requireBusinessPage } from "@/server/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { SignOutButton } from "@/components/app/sign-out-button";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("more") };
}

export default async function MorePage({ params }: PageProps<"/b/[businessId]/more">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  const t = await getTranslations("nav");
  const base = `/b/${businessId}`;
  const memberships = await activeMemberships(ctx.userId);

  const links: { href: string; label: string }[] = [{ href: base, label: t("dashboard") }];
  if (hasPermission(ctx, "employees.edit") || hasPermission(ctx, "employees.invite")) links.push({ href: `${base}/people`, label: t("people") });
  if (hasPermission(ctx, "timesheets.approve")) links.push({ href: `${base}/timesheets`, label: t("timesheets") });
  if (hasPermission(ctx, "reports.view")) links.push({ href: `${base}/reports`, label: t("reports") });
  if (["business.settings", "roles.manage", "payrules.manage", "blackout.manage"].some((p) => hasPermission(ctx, p as never)))
    links.push({ href: `${base}/settings`, label: t("settings") });
  links.push({ href: `${base}/account`, label: t("account") });
  if (memberships.length > 1) links.push({ href: "/", label: t("switchBusiness") });

  return (
    <>
      <PageHeader title={t("more")} />
      <ul className="divide-y rounded-lg border">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex min-h-12 items-center justify-between px-4 hover:bg-muted">
              {l.label}
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-6">
        <SignOutButton className="w-full md:w-auto" />
      </div>
    </>
  );
}
