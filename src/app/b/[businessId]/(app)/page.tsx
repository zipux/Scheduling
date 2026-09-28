import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { needsAttention } from "@/server/services/invitations";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  let invitationWarnings = 0;
  if (hasPermission(ctx, "employees.invite")) {
    const pending = await ctx.db.invitation.findMany({ where: { status: "pending" } });
    invitationWarnings = pending.filter((i) => needsAttention(i)).length;
  }
  return (
    <>
      {invitationWarnings > 0 && (
        <Alert variant="destructive" className="mb-4" data-testid="invitation-warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>{t("invitationWarningTitle", { count: invitationWarnings })}</AlertTitle>
          <AlertDescription>
            {t("invitationWarningBody")}{" "}
            <Link href={`/b/${businessId}/people`} className="font-medium underline">
              {t("reviewInvitations")}
            </Link>
          </AlertDescription>
        </Alert>
      )}
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
