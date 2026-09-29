import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{t("notFound")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("notFoundBody")}</p>
      <Link href="/" className="mt-6 inline-flex min-h-11 min-w-11 items-center justify-center underline">
        {t("back")}
      </Link>
    </main>
  );
}
