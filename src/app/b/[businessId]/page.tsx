import { getTranslations } from "next-intl/server";
import { requireBusinessPage } from "@/server/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

export default async function DashboardPage({ params }: PageProps<"/b/[businessId]">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  const t = await getTranslations("dashboard");
  return (
    <>
      <PageHeader title={t("welcome", { name: ctx.membership.displayName ?? ctx.userName })} description={ctx.membership.role.name} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("nextShift")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{t("noUpcomingShift")}</CardContent>
        </Card>
      </div>
    </>
  );
}
