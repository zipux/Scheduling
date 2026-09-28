"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CountBadge, usePulse } from "@/components/app/pulse";
import { markNotificationsReadAction, notificationsAction } from "@/app/b/[businessId]/(app)/messages/actions";

type N = { id: string; title: string; body: string; at: string; read: boolean; type: string };

/** In-app bell — always on, whatever the email preferences (§9.1). */
export function NotificationBell({ businessId }: { businessId: string }) {
  const t = useTranslations("notifications");
  const { notifications } = usePulse();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<N[] | null>(null);
  const [, start] = useTransition();
  const load = () =>
    start(async () => {
      const r = await notificationsAction(businessId, {});
      if (r.ok) setItems(r.data);
    });
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        aria-label={t("open", { count: notifications })}
        data-testid="notification-bell"
        onClick={() => {
          setOpen(true);
          load();
        }}
      >
        <Bell aria-hidden />
        <CountBadge count={notifications} label={t("unread", { count: notifications })} />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t("title")}</SheetTitle>
          </SheetHeader>
          <div className="px-4">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                start(async () => {
                  await markNotificationsReadAction(businessId, { ids: "all" });
                  load();
                })
              }
            >
              {t("markAllRead")}
            </Button>
            {items?.length === 0 && <p className="mt-4 text-sm text-muted-foreground">{t("empty")}</p>}
            <ul className="mt-3 space-y-2 pb-6" data-testid="notification-list">
              {items?.map((n) => (
                <li key={n.id} className={`rounded-md border p-3 text-sm ${n.read ? "" : "border-primary/40 bg-primary/5"}`}>
                  <p className="font-medium">{n.title}</p>
                  {n.body && <p className="text-muted-foreground">{n.body}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">{new Date(n.at).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
