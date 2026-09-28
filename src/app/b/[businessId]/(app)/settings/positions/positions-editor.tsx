"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FieldError } from "@/components/app/field-error";
import { useAction } from "@/components/app/use-action";
import { archivePositionAction, createPositionAction, updatePositionAction } from "../actions";

interface Row {
  id: string;
  name: string;
  color: string;
  requiresMinimumAge: number | null;
  archived: boolean;
  members: number;
}

function PositionForm({ businessId, row, onDone }: { businessId: string; row?: Row; onDone: () => void }) {
  const t = useTranslations("settings.positions");
  const { pending, fieldErrors, run } = useAction();
  const [name, setName] = useState(row?.name ?? "");
  const [color, setColor] = useState(row?.color ?? "#2563eb");
  const [age, setAge] = useState(row?.requiresMinimumAge ? String(row.requiresMinimumAge) : "");
  const key = row?.id ?? "new";
  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const position = { name, color, requiresMinimumAge: age };
        run<unknown>(
          () => (row ? updatePositionAction(businessId, { id: row.id, position: position as never }) : createPositionAction(businessId, position as never)),
          onDone,
          { success: t("saved") },
        );
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`pos-name-${key}`}>{t("name")}</Label>
        <Input id={`pos-name-${key}`} value={name} onChange={(e) => setName(e.target.value)} />
        <FieldError errors={fieldErrors.name ?? fieldErrors["position.name"]} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`pos-color-${key}`}>{t("color")}</Label>
        <Input id={`pos-color-${key}`} type="color" className="w-20 p-1" value={color} onChange={(e) => setColor(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`pos-age-${key}`}>{t("minimumAge")}</Label>
        <Input id={`pos-age-${key}`} inputMode="numeric" className="sm:w-28" value={age} onChange={(e) => setAge(e.target.value)} placeholder={t("none")} />
        <FieldError errors={fieldErrors.requiresMinimumAge ?? fieldErrors["position.requiresMinimumAge"]} />
      </div>
      <Button type="submit" disabled={pending}>
        {row ? t("save") : t("create")}
      </Button>
    </form>
  );
}

export function PositionsEditor({ businessId, positions }: { businessId: string; positions: Row[] }) {
  const t = useTranslations("settings.positions");
  const router = useRouter();
  const { pending, run } = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const done = () => {
    setOpen(null);
    router.refresh();
  };
  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-lg border" data-testid="position-list">
        {positions.map((p) => (
          <li key={p.id} className="space-y-3 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="size-4 shrink-0 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
              <span className="min-w-0 flex-1 font-medium">{p.name}</span>
              {p.requiresMinimumAge && <Badge variant="outline">{t("ageBadge", { age: p.requiresMinimumAge })}</Badge>}
              {p.archived && <Badge variant="secondary">{t("archived")}</Badge>}
              <Button size="sm" variant="outline" onClick={() => setOpen(open === p.id ? null : p.id)}>
                {t("edit")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => archivePositionAction(businessId, { id: p.id, archived: !p.archived }), done)}
              >
                {p.archived ? t("restore") : t("archive")}
              </Button>
            </div>
            {open === p.id && <PositionForm businessId={businessId} row={p} onDone={done} />}
          </li>
        ))}
      </ul>
      {open === "new" ? (
        <div className="rounded-lg border p-4">
          <PositionForm businessId={businessId} onDone={done} />
        </div>
      ) : (
        <Button onClick={() => setOpen("new")}>
          <Plus aria-hidden />
          {t("new")}
        </Button>
      )}
    </div>
  );
}
