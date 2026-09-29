import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/server/auth/context";
import { lookupInvitation } from "@/server/platform/accept-invitation";
import { SignOutButton } from "@/components/app/sign-out-button";
import { AcceptExisting, CreateAccountForm } from "./accept-forms";

export async function generateMetadata() {
  const t = await getTranslations("invite");
  return { title: t("title") };
}

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const t = await getTranslations("invite");
  const found = await lookupInvitation(token);
  const session = await getSession();

  let body: React.ReactNode;
  if (found.state !== "valid" || !found.invitation) {
    body = (
      <>
        <h1 className="text-2xl font-semibold">{t(`state.${found.state}.title`)}</h1>
        <p className="mt-2 text-muted-foreground">{t(`state.${found.state}.body`)}</p>
        <Link href="/" className="mt-6 inline-flex min-h-11 items-center underline">
          {t("goHome")}
        </Link>
      </>
    );
  } else {
    const inv = found.invitation;
    const header = (
      <>
        <h1 className="text-2xl font-semibold">{t("join", { business: inv.businessName })}</h1>
        <p className="mt-1 mb-6 text-muted-foreground">{t("asRole", { role: inv.roleName, email: inv.email })}</p>
      </>
    );
    if (session && session.user.email.toLowerCase() === inv.email.toLowerCase()) {
      body = (
        <>
          {header}
          <AcceptExisting token={token} />
        </>
      );
    } else if (session) {
      body = (
        <>
          {header}
          <p className="mb-4">{t("wrongAccount", { current: session.user.email, email: inv.email })}</p>
          <SignOutButton />
        </>
      );
    } else if (found.existingUser) {
      body = (
        <>
          {header}
          <p className="mb-4">{t("existingAccount")}</p>
          <Link
            href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}&email=${encodeURIComponent(inv.email)}`}
            className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-foreground"
          >
            {t("signInToAccept")}
          </Link>
        </>
      );
    } else {
      body = (
        <>
          {header}
          <CreateAccountForm token={token} defaultName={inv.name} email={inv.email} />
        </>
      );
    }
  }

  return <main id="main" tabIndex={-1} className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10">{body}</main>;
}
