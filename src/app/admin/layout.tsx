import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdminPage } from "@/server/platform/admin";
import { SignOutButton } from "@/components/app/sign-out-button";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requirePlatformAdminPage();
  const t = await getTranslations("admin");
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
        <Link href="/admin" className="flex min-h-11 items-center font-semibold">
          {t("title")}
        </Link>
        <Link href="/" className="ml-auto flex min-h-11 items-center text-sm underline">
          {t("myBusinesses")}
        </Link>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 py-6">{children}</main>
      <div className="mx-auto max-w-4xl px-4 pb-10">
        <SignOutButton />
      </div>
    </div>
  );
}
