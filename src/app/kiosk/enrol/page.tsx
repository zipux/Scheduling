import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/server/auth/context";
import { enrolmentOptions } from "@/server/auth/memberships";
import { EnrolForm } from "./enrol-form";

export default async function KioskEnrolPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/kiosk/enrol");
  const t = await getTranslations("kiosk");
  const options = await enrolmentOptions(session.user.id);
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">{t("enrolTitle")}</h1>
      <p className="mt-2 mb-6 text-sm text-muted-foreground">{t("enrolBody")}</p>
      {options.length === 0 ? <p>{t("enrolNone")}</p> : <EnrolForm options={options} />}
    </main>
  );
}
