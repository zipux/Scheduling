import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { activeMemberships, hasPermission, requireBusinessPage } from "@/server/auth/context";
import { BottomTabBar, SideNav, type NavKey } from "@/components/app/nav";
import { BusinessSwitcher } from "@/components/app/business-switcher";

export default async function BusinessLayout({ children, params }: LayoutProps<"/b/[businessId]">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  // Onboarding gates (§4): profile + PIN first, then the owner's setup wizard.
  if (!ctx.membership.profile?.completedAt) redirect(`/b/${businessId}/onboarding/profile`);
  if (!ctx.membership.profile.pinHmac) redirect(`/b/${businessId}/onboarding/pin`);
  if (!ctx.business.setupCompletedAt && ctx.actor.isOwner) redirect(`/b/${businessId}/onboarding/setup`);
  const t = await getTranslations("nav");
  const memberships = await activeMemberships(ctx.userId);
  const base = `/b/${businessId}`;

  const items: NavKey[] = ["dashboard", "schedule", "clock", "requests", "messages"];
  if (hasPermission(ctx, "employees.edit") || hasPermission(ctx, "employees.invite")) items.push("people");
  if (hasPermission(ctx, "timeclock.edit") || hasPermission(ctx, "timeclock.add")) items.push("timeclock");
  if (hasPermission(ctx, "timesheets.approve")) items.push("timesheets");
  if (hasPermission(ctx, "reports.view")) items.push("reports");
  if (["business.settings", "roles.manage", "payrules.manage", "blackout.manage", "timeclock.edit"].some((p) => hasPermission(ctx, p as never)))
    items.push("settings");
  items.push("more");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
        <Link href={base} className="flex min-h-11 min-w-0 items-center font-semibold">
          <span className="truncate">{ctx.business.name}</span>
        </Link>
        <div className="ml-auto">
          {memberships.length > 1 && (
            <BusinessSwitcher
              current={businessId}
              options={memberships.map((m) => ({ id: m.businessId, name: m.business.name }))}
              label={t("switchBusiness")}
            />
          )}
        </div>
      </header>
      <div className="flex flex-1">
        <SideNav base={base} items={items} />
        <main id="main" className="pb-tabbar w-full min-w-0 flex-1 px-4 pt-4 md:px-6">
          {children}
        </main>
      </div>
      <BottomTabBar base={base} />
    </div>
  );
}
