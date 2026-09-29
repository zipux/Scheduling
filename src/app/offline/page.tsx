import type { Metadata } from "next";
import { CloudOff } from "lucide-react";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("offline");
  return { title: t("title") };
}

/**
 * Served by the service worker in place of any page that can't load offline.
 * Plain links only: it must work even when none of the app's scripts are cached.
 */
export default async function OfflinePage() {
  const t = await getTranslations("offline");
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 py-16 text-center">
      <CloudOff className="mb-4 size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("body")}</p>
      <div className="mt-6 flex w-full flex-col gap-2">
        <a href="/clock" className="inline-flex h-12 items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-foreground">
          {t("openClock")}
        </a>
        {/* An empty href reloads the address the user asked for (this page is served in its place). */}
        <a href="" className="inline-flex h-12 items-center justify-center rounded-lg border px-4 font-medium">
          {t("retry")}
        </a>
      </div>
    </main>
  );
}
