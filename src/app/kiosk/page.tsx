import { cookies } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { authenticateKiosk, KIOSK_COOKIE, kioskStaff } from "@/server/platform/kiosk";
import { KioskScreen } from "./kiosk-screen";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("kiosk");
  return { title: t("title") };
}

export default async function KioskPage() {
  const t = await getTranslations("kiosk");
  const device = await authenticateKiosk((await cookies()).get(KIOSK_COOKIE)?.value);
  if (!device) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 text-center">
        <h1 className="text-2xl font-semibold">{t("notEnrolled")}</h1>
        <p className="mt-2 text-muted-foreground">{t("notEnrolledBody")}</p>
        <Link href="/" className="mt-6 inline-flex min-h-11 items-center justify-center underline">
          {t("signIn")}
        </Link>
      </main>
    );
  }
  const { location, staff } = await kioskStaff(device);
  return <KioskScreen deviceName={device.name} location={location} staff={staff} />;
}
