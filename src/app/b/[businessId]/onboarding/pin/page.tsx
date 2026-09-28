import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireBusinessPage } from "@/server/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { PinForm } from "./pin-form";

export default async function SetPinPage({ params }: PageProps<"/b/[businessId]/onboarding/pin">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  const profile = await ctx.db.employeeProfile.findUnique({ where: { membershipId: ctx.membership.id } });
  if (profile?.pinHmac) redirect(`/b/${businessId}`);
  const t = await getTranslations("profile");
  return (
    <>
      <PageHeader title={t("setPinTitle")} description={t("setPinSubtitle")} />
      <PinForm businessId={businessId} />
    </>
  );
}
