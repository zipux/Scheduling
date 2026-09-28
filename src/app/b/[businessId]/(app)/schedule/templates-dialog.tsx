"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/app/native-select";
import { TextField } from "@/components/app/form-fields";
import { useAction } from "@/components/app/use-action";
import { createTemplateAction, deleteTemplateAction } from "./actions";
import type { BoardData } from "./types";

export function TemplatesDialog({ data, onClose }: { data: BoardData; onClose: () => void }) {
  const t = useTranslations("schedule");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [v, setV] = useState({ name: "", start: "09:00", end: "17:00", breakMinutes: "30", locationId: "", positionId: "" });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("templates")}</DialogTitle>
          <DialogDescription>{t("templatesHint")}</DialogDescription>
        </DialogHeader>
        {data.templates.length > 0 && (
          <ul className="divide-y rounded-lg border" data-testid="template-list">
            {data.templates.map((tp) => (
              <li key={tp.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1">
                  <span className="font-medium">{tp.name}</span> · {tp.start}–{tp.end}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("deleteTemplate", { name: tp.name })}
                  disabled={pending}
                  onClick={() => run(() => deleteTemplateAction(data.businessId, { id: tp.id }), () => router.refresh())}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          noValidate
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run<unknown>(
              () =>
                createTemplateAction(data.businessId, {
                  ...v,
                  breakMinutes: Number(v.breakMinutes) || 0,
                  locationId: v.locationId || null,
                  positionId: v.positionId || null,
                }),
              () => {
                setV((s) => ({ ...s, name: "" }));
                router.refresh();
              },
              { success: t("templateSaved") },
            );
          }}
        >
          <TextField id="tp-name" label={t("templateName")} value={v.name} onChange={set("name")} errors={fieldErrors.name} placeholder={t("templateNamePlaceholder")} />
          <div className="grid grid-cols-3 gap-2">
            <TextField id="tp-start" type="time" label={t("start")} value={v.start} onChange={set("start")} errors={fieldErrors.start} />
            <TextField id="tp-end" type="time" label={t("end")} value={v.end} onChange={set("end")} errors={fieldErrors.end} />
            <TextField id="tp-break" inputMode="numeric" label={t("breakMinutes")} value={v.breakMinutes} onChange={set("breakMinutes")} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="tp-loc">{t("location")}</Label>
              <NativeSelect id="tp-loc" value={v.locationId} onChange={(e) => set("locationId")(e.target.value)}>
                <option value="">{t("any")}</option>
                {data.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tp-pos">{t("position")}</Label>
              <NativeSelect id="tp-pos" value={v.positionId} onChange={(e) => set("positionId")(e.target.value)}>
                <option value="">{t("any")}</option>
                {data.positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <Button type="submit" disabled={pending}>
            {t("saveTemplate")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
