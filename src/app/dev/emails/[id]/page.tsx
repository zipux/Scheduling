import Link from "next/link";
import { notFound } from "next/navigation";
import { rawDb } from "@/server/db/client";
import { simulateDelivery } from "./actions";

export const dynamic = "force-dynamic";

export default async function DevEmailPage({ params }: PageProps<"/dev/emails/[id]">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { id } = await params;
  const email = await rawDb.emailLog.findUnique({ where: { id } });
  if (!email) notFound();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link href="/dev/emails" className="inline-flex min-h-11 items-center text-sm underline">
        ← All emails
      </Link>
      <h1 className="mt-2 text-xl font-semibold">{email.subject}</h1>
      <p className="text-sm text-muted-foreground">
        To: {email.to} · Status: <span data-testid="dev-email-status">{email.status}</span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["delivered", "bounced", "complained"] as const).map((s) => (
          <form key={s} action={simulateDelivery.bind(null, email.id, s)}>
            <button type="submit" className="min-h-11 rounded-md border px-3 text-sm hover:bg-muted">
              Simulate {s}
            </button>
          </form>
        ))}
      </div>
      <iframe
        title={email.subject}
        sandbox=""
        srcDoc={email.html}
        className="mt-4 h-[480px] w-full rounded-lg border bg-white"
      />
      <details className="mt-4">
        <summary className="cursor-pointer text-sm">Plain text</summary>
        <pre className="mt-2 text-sm whitespace-pre-wrap" data-testid="dev-email-text">
          {email.text}
        </pre>
      </details>
    </main>
  );
}
