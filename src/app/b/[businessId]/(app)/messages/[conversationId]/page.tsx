import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireBusinessPage } from "@/server/auth/context";
import { conversationView } from "@/server/services/messaging";
import { UserError } from "@/server/action";
import { Thread } from "./thread";

export default async function ConversationPage({ params }: PageProps<"/b/[businessId]/messages/[conversationId]">) {
  const { businessId, conversationId } = await params;
  const ctx = await requireBusinessPage(businessId);
  const t = await getTranslations("messages");
  let view;
  try {
    view = await conversationView(ctx, conversationId);
  } catch (e) {
    if (e instanceof UserError) notFound();
    throw e;
  }
  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col md:h-[calc(100dvh-5rem)]">
      <div className="mb-2 flex items-center gap-2">
        <Link href={`/b/${businessId}/messages`} className="inline-flex min-h-11 items-center text-sm underline">
          ← {t("back")}
        </Link>
      </div>
      <Thread businessId={businessId} initial={view} tz={ctx.business.timezone} />
    </div>
  );
}
