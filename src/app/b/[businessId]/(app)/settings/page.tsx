import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import type { Permission } from "@/lib/permissions";
import { PageHeader } from "@/components/app/page-header";

const SECTIONS: { key: string; href: string; perm: Permission }[] = [
  { key: "business", href: "/settings/business", perm: "business.settings" },
  { key: "locations", href: "/settings/locations", perm: "business.settings" },
  { key: "positions", href: "/settings/positions", perm: "business.settings" },
  { key: "blackouts", href: "/settings/blackouts", perm: "blackout.manage" },
  { key: "kiosks", href: "/settings/kiosks", perm: "timeclock.edit" },
  { key: "roles", href: "/settings/roles", perm: "roles.manage" },
];

export default async function SettingsPage({ params }: PageProps<"/b/[businessId]/settings">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  const t = await getTranslations("settings");
  const visible = SECTIONS.filter((s) => hasPermission(ctx, s.perm));
  if (!visible.length && !hasPermission(ctx, "payrules.manage")) notFound();
  return (
    <>
      <PageHeader title={t("title")} />
      <ul className="divide-y rounded-lg border">
        {visible.map((s) => (
          <li key={s.key}>
            <Link href={`/b/${businessId}${s.href}`} className="flex min-h-14 items-center justify-between px-4 hover:bg-muted">
              <span>
                <span className="block font-medium">{t(`${s.key}.title`)}</span>
                <span className="block text-sm text-muted-foreground">{t(`${s.key}.summary`)}</span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
