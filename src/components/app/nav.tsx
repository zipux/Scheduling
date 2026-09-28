"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CalendarDays,
  Clock,
  Inbox,
  MessageSquare,
  MoreHorizontal,
  Home,
  Users,
  FileSpreadsheet,
  BarChart3,
  Settings,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CountBadge, usePulse } from "@/components/app/pulse";

export type NavKey =
  | "dashboard"
  | "schedule"
  | "clock"
  | "requests"
  | "messages"
  | "more"
  | "people"
  | "timesheets"
  | "timeclock"
  | "reports"
  | "settings";

const ICONS: Record<NavKey, LucideIcon> = {
  dashboard: Home,
  schedule: CalendarDays,
  clock: Clock,
  requests: Inbox,
  messages: MessageSquare,
  more: MoreHorizontal,
  people: Users,
  timesheets: FileSpreadsheet,
  timeclock: ClipboardCheck,
  reports: BarChart3,
  settings: Settings,
};

const PATHS: Record<NavKey, string> = {
  dashboard: "",
  schedule: "/schedule",
  clock: "/clock",
  requests: "/requests",
  messages: "/messages",
  more: "/more",
  people: "/people",
  timesheets: "/timesheets",
  timeclock: "/timeclock",
  reports: "/reports",
  settings: "/settings",
};

/** Spec §11: bottom tab bar is exactly Schedule, Clock, Requests, Messages, More. */
const TABS: NavKey[] = ["schedule", "clock", "requests", "messages", "more"];

function useIsActive(base: string) {
  const pathname = usePathname();
  return (key: NavKey) => {
    const href = base + PATHS[key];
    return key === "dashboard" ? pathname === base : pathname === href || pathname.startsWith(href + "/");
  };
}

export function BottomTabBar({ base }: { base: string }) {
  const t = useTranslations("nav");
  const isActive = useIsActive(base);
  const pulse = usePulse();
  const unread = pulse.messages + pulse.announcements;
  return (
    <nav
      aria-label={t("mainNavigation")}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      data-testid="bottom-tab-bar"
    >
      <ul className="grid grid-cols-5">
        {TABS.map((key) => {
          const Icon = ICONS[key];
          const active = isActive(key);
          return (
            <li key={key}>
              <Link
                href={base + PATHS[key]}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="relative">
                  <Icon className="size-5" aria-hidden />
                  {key === "messages" && <CountBadge count={unread} label={t("unreadMessages", { count: unread })} />}
                </span>
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SideNav({ base, items }: { base: string; items: NavKey[] }) {
  const t = useTranslations("nav");
  const isActive = useIsActive(base);
  const pulse = usePulse();
  const unread = pulse.messages + pulse.announcements;
  return (
    <nav aria-label={t("mainNavigation")} className="hidden w-56 shrink-0 border-r md:block" data-testid="side-nav">
      <ul className="sticky top-14 space-y-1 p-3">
        {items.map((key) => {
          const Icon = ICONS[key];
          const active = isActive(key);
          return (
            <li key={key}>
              <Link
                href={base + PATHS[key]}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-md px-3 text-sm",
                  active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60",
                )}
              >
                <Icon className="size-4" aria-hidden />
                <span className="relative">
                  {t(key)}
                  {key === "messages" && <CountBadge count={unread} label={t("unreadMessages", { count: unread })} />}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
