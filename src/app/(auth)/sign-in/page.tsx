import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/server/auth/context";
import { SignInForm } from "./sign-in-form";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("signInTitle") };
}

/** Only same-origin relative paths are accepted as a post-sign-in destination. */
function safeNext(v: unknown): string {
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/";
}

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getSession()) redirect(next);
  const t = await getTranslations();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10">
      <p className="mb-6 text-center text-lg font-semibold">{t("app.name")}</p>
      <h1 className="text-2xl font-semibold">{t("auth.signInTitle")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{t("auth.signInSubtitle")}</p>
      <SignInForm next={next} defaultEmail={typeof sp.email === "string" ? sp.email : ""} />
      <p className="mt-8 text-center text-xs text-muted-foreground">{t("auth.noAccountHint")}</p>
    </main>
  );
}
