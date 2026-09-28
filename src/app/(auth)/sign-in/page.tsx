import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/server/auth/context";
import { SignInForm } from "./sign-in-form";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("signInTitle") };
}

export default async function SignInPage() {
  if (await getSession()) redirect("/");
  const t = await getTranslations();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10">
      <p className="mb-6 text-center text-lg font-semibold">{t("app.name")}</p>
      <h1 className="text-2xl font-semibold">{t("auth.signInTitle")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{t("auth.signInSubtitle")}</p>
      <SignInForm />
      <p className="mt-8 text-center text-xs text-muted-foreground">{t("auth.noAccountHint")}</p>
    </main>
  );
}
