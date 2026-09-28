import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatInTimeZone } from "date-fns-tz";
import { BellOff, Megaphone, MessageSquare, Users } from "lucide-react";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { announcementsForMe, listConversations } from "@/server/services/messaging";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AnnouncementComposer, AnnouncementItem, MarkRead, NewChat } from "./tools";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("messages") };
}

export default async function MessagesPage({ params, searchParams }: PageProps<"/b/[businessId]/messages">) {
  const { businessId } = await params;
  const sp = await searchParams;
  const ctx = await requireBusinessPage(businessId);
  const t = await getTranslations("messages");
  const tab = sp.tab === "announcements" ? "announcements" : "chats";
  const base = `/b/${businessId}/messages`;
  const tz = ctx.business.timezone;
  const canBroadcast = hasPermission(ctx, "messages.broadcast");

  const tabs = (
    <nav className="-mx-4 mb-4 flex gap-1 px-4" aria-label={t("title")}>
      {(["chats", "announcements"] as const).map((k) => (
        <Link key={k} href={`${base}?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={cn("inline-flex h-11 items-center rounded-lg border px-4 text-sm md:h-9", tab === k && "border-primary bg-primary text-primary-foreground")}>
          {t(`tabs.${k}`)}
        </Link>
      ))}
    </nav>
  );

  if (tab === "announcements") {
    const items = await announcementsForMe(ctx);
    const [locations, roles, positions] = canBroadcast
      ? await Promise.all([ctx.db.location.findMany({ where: { archivedAt: null } }), ctx.db.role.findMany({ orderBy: { rank: "asc" } }), ctx.db.position.findMany({ where: { archivedAt: null } })])
      : [[], [], []];
    return (
      <>
        <PageHeader title={t("title")} />
        {tabs}
        <MarkRead businessId={businessId} ids={items.filter((a) => !a.read).map((a) => a.id)} />
        {canBroadcast && (
          <AnnouncementComposer
            businessId={businessId}
            locations={locations.map((l) => ({ id: l.id, name: l.name }))}
            roles={roles.map((r) => ({ id: r.id, name: r.name }))}
            positions={positions.map((p) => ({ id: p.id, name: p.name }))}
          />
        )}
        {items.length === 0 ? (
          <EmptyState icon={Megaphone} title={t("noAnnouncements")} />
        ) : (
          <ul className="space-y-3" data-testid="announcements">
            {items.map((a) => (
              <AnnouncementItem key={a.id} businessId={businessId} a={{ ...a, at: formatInTimeZone(a.at, tz, "EEE d MMM HH:mm") }} canSeeReceipts={a.mine || canBroadcast} />
            ))}
          </ul>
        )}
      </>
    );
  }

  const [conversations, people] = await Promise.all([
    listConversations(ctx),
    ctx.db.membership.findMany({ where: { status: "active", accessRevokedAt: null, NOT: { id: ctx.membership.id } }, include: { user: { select: { name: true } } } }),
  ]);
  return (
    <>
      <PageHeader title={t("title")} actions={<NewChat businessId={businessId} people={people.map((p) => ({ id: p.id, name: p.displayName ?? p.user.name })).sort((a, b) => a.name.localeCompare(b.name))} />} />
      {tabs}
      {conversations.length === 0 ? (
        <EmptyState icon={MessageSquare} title={t("noChats")} body={t("noChatsBody")} />
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="conversations">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link href={`${base}/${c.id}`} className="flex min-h-16 items-center gap-3 px-4 py-2 hover:bg-muted">
                {c.kind === "direct" ? <MessageSquare className="size-5 shrink-0 text-muted-foreground" aria-hidden /> : <Users className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.title}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {c.last ? `${c.lastSender}: ${c.last.body || t("image")}` : t("noMessagesYet")}
                  </span>
                </span>
                {c.muted && <BellOff className="size-4 text-muted-foreground" aria-label={t("muted")} />}
                {c.unread > 0 && <Badge data-testid="unread-badge">{c.unread}</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
