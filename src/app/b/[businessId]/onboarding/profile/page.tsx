import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireBusinessPage } from "@/server/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { ProfileForm } from "./profile-form";

export async function generateMetadata() {
  const t = await getTranslations("profile");
  return { title: t("title") };
}

export default async function ProfilePage({ params }: PageProps<"/b/[businessId]/onboarding/profile">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  if (ctx.membership.profile?.completedAt) redirect(`/b/${businessId}`);
  const t = await getTranslations("profile");
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ProfileForm businessId={businessId} />
    </>
  );
}
