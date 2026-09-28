import { getTranslations } from "next-intl/server";
import { Construction } from "lucide-react";
import { requireBusinessPage } from "@/server/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("requests") };
}

export default async function RequestsPage({ params }: PageProps<"/b/[businessId]/requests">) {
  const { businessId } = await params;
  await requireBusinessPage(businessId);
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t("nav.requests")} />
      <EmptyState icon={Construction} title={t("placeholder.notYet")} body={t("placeholder.notYetBody")} />
    </>
  );
}
