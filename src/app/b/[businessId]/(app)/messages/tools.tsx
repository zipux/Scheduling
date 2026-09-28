"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/app/native-select";
import { SwitchField, TextField } from "@/components/app/form-fields";
import { FieldError } from "@/components/app/field-error";
import { useAction } from "@/components/app/use-action";
import { confirmAnnouncementAction, createGroupAction, markAnnouncementsReadAction, openDirectAction, receiptsAction, sendAnnouncementAction } from "./actions";

type Opt = { id: string; name: string };

export function NewChat({ businessId, people }: { businessId: string; people: Opt[] }) {
  const t = useTranslations("messages");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"direct" | "group">("direct");
  const [person, setPerson] = useState(people[0]?.id ?? "");
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const go = (id: string) => router.push(`/b/${businessId}/messages/${id}`);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {t("newChat")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("newChat")}</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            <Button variant={mode === "direct" ? "default" : "outline"} onClick={() => setMode("direct")}>
              {t("direct")}
            </Button>
            <Button variant={mode === "group" ? "default" : "outline"} onClick={() => setMode("group")}>
              {t("group")}
            </Button>
          </div>
          {mode === "direct" ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="dm-person">{t("person")}</Label>
                <NativeSelect id="dm-person" value={person} onChange={(e) => setPerson(e.target.value)}>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button disabled={pending || !person} onClick={() => run(() => openDirectAction(businessId, { id: person }), (r) => go(r.id))}>
                {t("start")}
              </Button>
            </div>
          ) : (
            <form
              noValidate
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => createGroupAction(businessId, { name, memberIds: members }), (r) => go(r.id));
              }}
            >
              <TextField id="grp-name" label={t("groupName")} value={name} onChange={setName} errors={fieldErrors.name} />
              <fieldset className="max-h-60 overflow-y-auto">
                <legend className="mb-1 text-sm font-medium">{t("members")}</legend>
                {people.map((p) => (
                  <label key={p.id} className="flex min-h-11 items-center gap-3">
                    <Checkbox className="size-5" checked={members.includes(p.id)} onCheckedChange={(c) => setMembers((m) => (c ? [...m, p.id] : m.filter((x) => x !== p.id)))} />
                    {p.name}
                  </label>
                ))}
              </fieldset>
              <FieldError errors={fieldErrors.memberIds} />
              <Button type="submit" disabled={pending}>
                {t("createGroup")}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Viewing the announcements tab marks them read (a read receipt). */
export function MarkRead({ businessId, ids }: { businessId: string; ids: string[] }) {
  const key = ids.join(",");
  useEffect(() => {
    if (key) void markAnnouncementsReadAction(businessId, { ids: key.split(",") });
  }, [businessId, key]);
  return null;
}

export function AnnouncementComposer({ businessId, locations, roles, positions }: { businessId: string; locations: Opt[]; roles: Opt[]; positions: Opt[] }) {
  const t = useTranslations("messages");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [type, setType] = useState<"all" | "location" | "role" | "position">("all");
  const [target, setTarget] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [confirm, setConfirm] = useState(false);
  const opts = type === "location" ? locations : type === "role" ? roles : type === "position" ? positions : [];
  return (
    <form
      noValidate
      className="mb-6 space-y-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const audience = type === "all" ? { type } : { type, id: target || opts[0]?.id };
        run<unknown>(() => sendAnnouncementAction(businessId, { audience: audience as never, title, body, requireReadConfirmation: confirm }), () => {
          setTitle("");
          setBody("");
          router.refresh();
        }, { success: t("announcementSent") });
      }}
    >
      <h2 className="font-medium">{t("newAnnouncement")}</h2>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="an-type">{t("audience")}</Label>
          <NativeSelect id="an-type" value={type} onChange={(e) => { setType(e.target.value as typeof type); setTarget(""); }}>
            <option value="all">{t("everyone")}</option>
            <option value="location">{t("aLocation")}</option>
            <option value="role">{t("aRole")}</option>
            <option value="position">{t("aPosition")}</option>
          </NativeSelect>
        </div>
        {type !== "all" && (
          <div className="space-y-1">
            <Label htmlFor="an-target">{t("which")}</Label>
            <NativeSelect id="an-target" value={target || opts[0]?.id} onChange={(e) => setTarget(e.target.value)}>
              {opts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>
      <TextField id="an-title" label={t("titleLabel")} value={title} onChange={setTitle} errors={fieldErrors.title} />
      <div className="space-y-1">
        <Label htmlFor="an-body">{t("body")}</Label>
        <Textarea id="an-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        <FieldError errors={fieldErrors.body} />
      </div>
      <SwitchField label={t("requireConfirmation")} checked={confirm} onChange={setConfirm} />
      <Button type="submit" disabled={pending}>
        {t("send")}
      </Button>
    </form>
  );
}

export function AnnouncementItem({
  businessId,
  a,
  canSeeReceipts,
}: {
  businessId: string;
  a: { id: string; title: string; body: string; at: string; mine: boolean; requireReadConfirmation: boolean; read: boolean; confirmed: boolean };
  canSeeReceipts: boolean;
}) {
  const t = useTranslations("messages");
  const router = useRouter();
  const { pending, run } = useAction();
  const [receipts, setReceipts] = useState<{ name: string; read: boolean; confirmed: boolean }[] | null>(null);
  return (
    <li className="rounded-lg border p-4" data-testid="announcement">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 font-medium">{a.title}</h3>
        {!a.read && <Badge>{t("new")}</Badge>}
        <span className="text-xs text-muted-foreground">{a.at}</span>
      </div>
      <p className="mt-1 text-sm whitespace-pre-wrap">{a.body}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {a.requireReadConfirmation && !a.mine && (a.confirmed ? <Badge variant="secondary">{t("confirmed")}</Badge> : (
          <Button size="sm" disabled={pending} onClick={() => run(() => confirmAnnouncementAction(businessId, { id: a.id }), () => router.refresh(), { success: t("thanks") })}>
            {t("confirmRead")}
          </Button>
        ))}
        {canSeeReceipts && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => receiptsAction(businessId, { id: a.id }), (r) => setReceipts(r))}>
            {t("receipts")}
          </Button>
        )}
      </div>
      {receipts && (
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2" data-testid="receipts">
          {receipts.map((r, i) => (
            <li key={i}>
              {r.name}: {r.confirmed ? t("confirmed") : r.read ? t("read") : t("unread")}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
