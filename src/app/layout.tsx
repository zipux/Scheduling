import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Toaster } from "@/components/ui/sonner";
import { OfflineBanner } from "@/components/app/offline-banner";
import { ServiceWorkerRegistrar } from "@/components/app/service-worker";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return { title: { default: t("name"), template: `%s · ${t("name")}` }, description: t("tagline") };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#111111",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const t = await getTranslations("common");
  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">
        <a
          href="#main"
          className="sr-only z-[100] rounded-md bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>
          <OfflineBanner />
          {children}
          <Toaster position="top-center" />
          <ServiceWorkerRegistrar />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
