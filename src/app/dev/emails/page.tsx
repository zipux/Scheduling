import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { rawDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

// Dev only (Spec rule 4): read emails captured while RESEND_API_KEY is unset.
export default async function DevEmailsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const t = await getTranslations("devEmails");
  const emails = await rawDb.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t("subtitle")}</p>
      {emails.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="dev-email-list">
          {emails.map((e) => (
            <li key={e.id}>
              <Link href={`/dev/emails/${e.id}`} className="block px-4 py-3 hover:bg-muted">
                <span className="block font-medium">{e.subject}</span>
                <span className="block text-sm text-muted-foreground">
                  {e.to} · {e.createdAt.toISOString()} · {e.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
