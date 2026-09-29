"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Bell, BellOff, ImagePlus, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { leaveGroupAction, muteAction, pollMessagesAction, sendMessageAction, uploadImageAction } from "../actions";

type Msg = { id: string; mine: boolean; sender: string; body: string; attachment: string | null; at: string };
type View = { id: string; kind: string; title: string; members: string[]; muted: boolean; messages: Msg[] };

const POLL_MS = 5000;

export function Thread({ businessId, initial, tz }: { businessId: string; initial: View; tz: string }) {
  const t = useTranslations("messages");
  const locale = useLocale();
  const router = useRouter();
  const [messages, setMessages] = useState(initial.messages);
  const [muted, setMuted] = useState(initial.muted);
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const bottom = useRef<HTMLLIElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const lastAt = messages.at(-1)?.at ?? null;

  // Polling every 5 s (§2 realtime: polling, no extra infrastructure).
  useEffect(() => {
    let alive = true;
    const id = setInterval(async () => {
      const r = await pollMessagesAction(businessId, { id: initial.id, after: lastAt }).catch(() => null);
      if (alive && r?.ok && r.data.length) setMessages((m) => [...m, ...r.data.filter((x) => !m.some((y) => y.id === x.id))]);
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [businessId, initial.id, lastAt]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function send(attachmentKey: string | null = null) {
    const text = body.trim();
    if (!text && !attachmentKey) return;
    start(async () => {
      const r = await sendMessageAction(businessId, { conversationId: initial.id, body: text, attachmentKey });
      if (!r.ok) return void toast.error(r.error);
      setBody("");
      const more = await pollMessagesAction(businessId, { id: initial.id, after: lastAt });
      if (more.ok) setMessages((m) => [...m, ...more.data.filter((x) => !m.some((y) => y.id === x.id))]);
    });
  }

  function attach(f: File | undefined) {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return void toast.error(t("tooBig"));
    start(async () => {
      const fd = new FormData();
      fd.set("file", f);
      const r = await uploadImageAction(businessId, fd);
      if (!r.ok) return void toast.error(r.error);
      send(r.data.key);
    });
  }

  const fmt = (iso: string) => new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold">{initial.title}</h1>
          {initial.kind !== "direct" && <p className="truncate text-xs text-muted-foreground">{initial.members.join(", ")}</p>}
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label={muted ? t("unmute") : t("mute")}
          onClick={() => start(async () => {
            const r = await muteAction(businessId, { id: initial.id, muted: !muted });
            if (r.ok) setMuted(!muted);
          })}
        >
          {muted ? <BellOff aria-hidden /> : <Bell aria-hidden />}
        </Button>
        {initial.kind === "group" && (
          <Button size="sm" variant="ghost" onClick={() => start(async () => {
            const r = await leaveGroupAction(businessId, { id: initial.id });
            if (r.ok) router.push(`/b/${businessId}/messages`);
          })}>
            {t("leave")}
          </Button>
        )}
      </header>
      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" data-testid="thread" aria-live="polite">
        {messages.map((m) => (
          <li key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm", m.mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
              {!m.mine && initial.kind !== "direct" && <p className="text-xs font-medium opacity-80">{m.sender}</p>}
              {m.attachment && (
                // eslint-disable-next-line @next/next/no-img-element -- authenticated private file, not optimisable
                <img src={`/api/b/${businessId}/files/${m.attachment}`} alt={t("imageFrom", { name: m.sender })} className="mb-1 max-h-64 rounded-lg" />
              )}
              {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
              <p className="mt-0.5 text-[10px] opacity-70">{fmt(m.at)}</p>
            </div>
          </li>
        ))}
        <li ref={bottom} aria-hidden="true" />
      </ol>
      <form
        className="flex items-end gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => attach(e.target.files?.[0])} aria-label={t("attachImage")} />
        <Button type="button" size="icon" variant="ghost" aria-label={t("attachImage")} onClick={() => file.current?.click()} disabled={pending}>
          <ImagePlus aria-hidden />
        </Button>
        <Textarea
          aria-label={t("message")}
          rows={1}
          className="min-h-11 flex-1 resize-none"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button type="submit" size="icon" aria-label={t("send")} disabled={pending || !body.trim()}>
          <Send aria-hidden />
        </Button>
      </form>
    </div>
  );
}
