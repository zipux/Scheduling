"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarPlus, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/app/use-action";
import { rotateCalendarFeedAction } from "./actions";

export function CalendarFeedButton({ businessId, hasFeed }: { businessId: string; hasFeed: boolean }) {
  const t = useTranslations("schedule");
  const { pending, run } = useAction();
  const [url, setUrl] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button variant="outline" disabled={pending} onClick={() => run(() => rotateCalendarFeedAction(businessId, {}), (u) => setUrl(u))}>
        <CalendarPlus aria-hidden />
        {hasFeed || url ? t("newFeedLink") : t("getFeedLink")}
      </Button>
      {hasFeed && !url && <p className="text-xs text-muted-foreground">{t("feedRotateHint")}</p>}
      {url && (
        <div className="flex gap-2">
          <Input readOnly value={url} aria-label={t("feedUrl")} onFocus={(e) => e.currentTarget.select()} data-testid="feed-url" />
          <Button
            variant="outline"
            size="icon"
            aria-label={t("copy")}
            onClick={async () => {
              await navigator.clipboard?.writeText(url).catch(() => {});
              toast.success(t("copied"));
            }}
          >
            <Copy aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
