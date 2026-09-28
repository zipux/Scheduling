import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { activeMemberships, requireUser } from "@/server/auth/context";
import { SignOutButton } from "@/components/app/sign-out-button";

export default async function Home() {
  const user = await requireUser();
  const memberships = await activeMemberships(user.id);
  const t = await getTranslations();

  if (memberships.length === 1 && !user.isPlatformAdmin) redirect(`/b/${memberships[0].businessId}`);
  if (memberships.length === 0 && user.isPlatformAdmin) redirect("/admin");

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">{t("app.name")}</h1>
      {memberships.length === 0 ? (
        <div className="mt-6 space-y-2">
          <p>{t("home.noBusinesses")}</p>
          <p className="text-sm text-muted-foreground">{t("home.noBusinessesHint")}</p>
        </div>
      ) : (
        <>
          <h2 className="mt-6 mb-3 text-sm font-medium text-muted-foreground">{t("home.chooseBusiness")}</h2>
          <ul className="space-y-2">
            {memberships.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/b/${m.businessId}`}
                  className="flex min-h-14 items-center justify-between rounded-lg border px-4 hover:bg-muted"
                >
                  <span className="font-medium">{m.business.name}</span>
                  <span className="text-sm text-muted-foreground">{m.role.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {user.isPlatformAdmin && (
        <Link href="/admin" className="mt-6 inline-flex min-h-11 items-center underline">
          {t("nav.platformAdmin")}
        </Link>
      )}
      <div className="mt-8">
        <SignOutButton />
      </div>
    </main>
  );
}
