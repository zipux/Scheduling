"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Copy, Plus, Send, TriangleAlert, LayoutTemplate, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/app/native-select";
import { useAction } from "@/components/app/use-action";
import { warningText } from "@/components/app/warning-text";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { copyWeekAction, moveShiftAction, publishWeekAction, saveLocationPreferenceAction } from "./actions";
import { ShiftEditor, type EditorSeed } from "./shift-editor";
import { TemplatesDialog } from "./templates-dialog";
import type { BoardData, BoardShift } from "./types";

const OPEN = "__open__";

function dayLabel(date: string, style: "short" | "long" = "short") {
  const d = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    day: "numeric",
    month: style === "long" ? "long" : "short",
    timeZone: "UTC",
  }).format(d);
}

function ShiftChip({
  s,
  showLocation,
  memberName,
  onOpen,
  draggable,
}: {
  s: BoardShift;
  showLocation: boolean;
  memberName?: string;
  onOpen?: () => void;
  draggable: boolean;
}) {
  const t = useTranslations("schedule");
  const tw = useTranslations("warnings");
  const warnText = s.warnings.map((w) => warningText(tw, w));
  const body = (
    <>
      <span className="flex items-center gap-1 font-medium tabular-nums">
        {s.start}–{s.end}
        {s.warnings.length > 0 && <TriangleAlert className="size-3.5 shrink-0 text-amber-600" aria-label={t("hasWarnings")} />}
      </span>
      {memberName && <span className="block truncate">{memberName}</span>}
      <span className="block truncate text-muted-foreground">
        {[s.positionName, showLocation ? s.locationName : null].filter(Boolean).join(" · ")}
      </span>
      {s.status === "draft" && (
        <Badge variant="outline" className="mt-0.5 h-4 px-1 text-[10px]">
          {t("draft")}
        </Badge>
      )}
      {warnText.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[11px] leading-tight text-amber-800 dark:text-amber-300" data-testid="shift-warnings">
          {warnText.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </>
  );
  const cls = cn(
    "block w-full rounded-md border-l-4 bg-card px-2 py-1 text-left text-xs shadow-sm ring-1 ring-border",
    s.status === "draft" && "border-dashed bg-muted/40",
    s.past && "opacity-60",
    s.warnings.length > 0 && "ring-amber-400",
  );
  const style = { borderLeftColor: s.color };
  if (!onOpen) {
    return (
      <div className={cls} style={style} data-testid="shift-chip">
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cn(cls, "min-h-11 hover:bg-muted")}
      style={style}
      onClick={onOpen}
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData("text/shift-id", s.id)}
      data-testid="shift-chip"
    >
      {body}
    </button>
  );
}

export function ScheduleBoard({ data }: { data: BoardData }) {
  const t = useTranslations("schedule");
  const tw = useTranslations("warnings");
  const router = useRouter();
  const sp = useSearchParams();
  const { pending, run } = useAction();
  const [editor, setEditor] = useState<EditorSeed | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [day, setDay] = useState(data.days.includes(data.today) ? data.today : data.days[0]);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const all = data.scope.selected === "all";
  const showLocation = all || data.locations.length > 1;
  const base = `/b/${data.businessId}/schedule`;
  const href = (params: Record<string, string>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(params)) q.set(k, v);
    return `${base}?${q.toString()}`;
  };
  const nameOf = new Map(data.members.map((m) => [m.id, m.name]));
  const weekWarnings = data.shifts.filter((s) => s.warnings.length > 0);
  const holidayOn = (d: string) => data.holidays.filter((h) => h.date === d);

  function onDrop(e: React.DragEvent, date: string, rowId: string) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/shift-id");
    if (!id) return;
    const membershipId = rowId === OPEN ? null : rowId;
    run<unknown>(() => moveShiftAction(data.businessId, { id, date, membershipId }), () => router.refresh(), { success: t("moved") });
  }

  const rows = [{ id: OPEN, name: t("openShifts") }, ...data.members.map((m) => ({ id: m.id, name: m.name }))];
  const loaded = data.wages && data.wages.burdenPercent !== null ? Math.round(data.wages.week * (1 + data.wages.burdenPercent / 100)) : null;

  return (
    <div>
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold md:text-2xl">{t("title")}</h1>
        <Link href={`${base}?view=mine`} className="inline-flex h-11 items-center rounded-lg border px-3 text-sm md:h-9">
          {t("myShifts")}
        </Link>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Link href={href({ week: data.prevWeek })} aria-label={t("prevWeek")} className="inline-flex size-11 items-center justify-center rounded-lg border md:size-9">
            <ChevronLeft className="size-4" />
          </Link>
          <Link href={href({ week: data.thisWeek })} className="inline-flex h-11 items-center rounded-lg border px-3 text-sm md:h-9">
            {t("weekOf", { date: dayLabel(data.weekStart, "long") })}
          </Link>
          <Link href={href({ week: data.nextWeek })} aria-label={t("nextWeek")} className="inline-flex size-11 items-center justify-center rounded-lg border md:size-9">
            <ChevronRight className="size-4" />
          </Link>
        </div>
        {data.scope.showSwitcher && (
          <NativeSelect
            aria-label={t("locationSwitcher")}
            className="w-auto min-w-40"
            value={data.scope.selected ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              run(() => saveLocationPreferenceAction(data.businessId, { value }), () => router.push(href({ loc: value })));
            }}
          >
            {data.scope.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
            <option value="all">{t("allLocations")}</option>
          </NativeSelect>
        )}
        {data.canEdit && (
          <div className="flex flex-wrap gap-2 md:ml-auto">
            <Button variant="outline" onClick={() => setEditor({ date: day })}>
              <Plus aria-hidden />
              {t("addShift")}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(
                  () => copyWeekAction(data.businessId, { weekStart: data.weekStart, locationIds: data.locations.map((l) => l.id) }),
                  () => router.refresh(),
                  { success: t("copiedWeek") },
                )
              }
            >
              <Copy aria-hidden />
              {t("copyWeek")}
            </Button>
            <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
              <LayoutTemplate aria-hidden />
              {t("templates")}
            </Button>
            {data.canPublish && (
              <Button onClick={() => setPublishOpen(true)} disabled={data.draftCount === 0}>
                <Send aria-hidden />
                {t("publish", { count: data.draftCount })}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Scheduled wages (§5.3) — never labelled "labour cost". */}
      {data.wages && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-sm" data-testid="scheduled-wages">
          <span>
            {t("scheduledWages")}: <strong className="tabular-nums">{formatCents(data.wages.week, data.wages.currency)}</strong>
          </span>
          {loaded !== null && (
            <span className="inline-flex items-center gap-1">
              · {t("loadedCost")}: <strong className="tabular-nums">{formatCents(loaded, data.wages.currency)}</strong>
              <span title={data.wages.burdenNote || t("burdenDefault", { percent: data.wages.burdenPercent! })} className="inline-flex">
                <Info className="size-4 text-muted-foreground" aria-hidden />
                <span className="sr-only">{data.wages.burdenNote || t("burdenDefault", { percent: data.wages.burdenPercent! })}</span>
              </span>
            </span>
          )}
          {data.wages.missingWage > 0 && <span className="text-amber-700">{t("missingWage", { count: data.wages.missingWage })}</span>}
        </div>
      )}

      {/* Desktop grid: employees × days */}
      <div className="hidden overflow-x-auto rounded-lg border md:block" data-testid="schedule-grid">
        <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50">
              <th className="w-40 p-2 text-left font-medium">{t("employee")}</th>
              {data.days.map((d) => (
                <th key={d} className={cn("p-2 text-left font-medium", d === data.today && "bg-primary/5")}>
                  <span className="block">{dayLabel(d)}</span>
                  {holidayOn(d).map((h) => (
                    <Badge key={h.name} variant="secondary" className="mt-1 max-w-full truncate" data-testid="holiday">
                      {h.isStatutory ? "★ " : ""}
                      {h.name}
                    </Badge>
                  ))}
                  {data.wages && (
                    <span className="block text-xs font-normal text-muted-foreground tabular-nums">{formatCents(data.wages.byDay[d] ?? 0, data.wages.currency)}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t align-top">
                <th scope="row" className="p-2 text-left font-normal">
                  {r.id === OPEN ? <span className="text-muted-foreground italic">{r.name}</span> : r.name}
                </th>
                {data.days.map((d) => {
                  const cellKey = `${r.id}|${d}`;
                  const cell = data.shifts.filter((s) => s.date === d && (r.id === OPEN ? !s.membershipId : s.membershipId === r.id));
                  return (
                    <td
                      key={d}
                      className={cn("space-y-1 p-1", dragOver === cellKey && "bg-primary/10", d === data.today && "bg-primary/5")}
                      onDragOver={data.canEdit ? (e) => (e.preventDefault(), setDragOver(cellKey)) : undefined}
                      onDragLeave={() => setDragOver(null)}
                      onDrop={data.canEdit ? (e) => onDrop(e, d, r.id) : undefined}
                    >
                      {cell.map((s) => (
                        <ShiftChip key={s.id} s={s} showLocation={showLocation} onOpen={data.canEdit ? () => setEditor({ shift: s }) : undefined} draggable={data.canEdit} />
                      ))}
                      {data.canEdit && (
                        <button
                          type="button"
                          aria-label={t("addFor", { name: r.name, date: dayLabel(d) })}
                          className="flex h-6 w-full items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted hover:opacity-100 focus:opacity-100"
                          onClick={() => setEditor({ date: d, membershipId: r.id === OPEN ? null : r.id })}
                        >
                          <Plus className="size-3" aria-hidden />
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: day list */}
      <div className="md:hidden" data-testid="schedule-day-list">
        <div className="-mx-4 mb-3 flex gap-1 overflow-x-auto px-4 pb-1" role="tablist" aria-label={t("days")}>
          {data.days.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === day}
              onClick={() => setDay(d)}
              className={cn(
                "flex min-h-12 min-w-12 flex-col items-center justify-center rounded-lg border px-2 text-xs",
                d === day ? "border-primary bg-primary text-primary-foreground" : "bg-background",
              )}
            >
              <span>{dayLabel(d).split(",")[0]}</span>
              <span className="font-semibold">{Number(d.slice(8))}</span>
            </button>
          ))}
        </div>
        <h2 className="mb-2 font-medium">{dayLabel(day, "long")}</h2>
        {holidayOn(day).map((h) => (
          <p key={h.name} className="mb-2 text-sm" data-testid="holiday">
            <Badge variant="secondary">{h.isStatutory ? "★ " : ""}{h.name}</Badge>
          </p>
        ))}
        {data.wages && (
          <p className="mb-2 text-sm text-muted-foreground">
            {t("scheduledWages")}: <span className="tabular-nums">{formatCents(data.wages.byDay[day] ?? 0, data.wages.currency)}</span>
          </p>
        )}
        {(() => {
          const list = data.shifts.filter((s) => s.date === day).sort((a, b) => a.start.localeCompare(b.start));
          if (!list.length) return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("noShiftsDay")}</p>;
          return (
            <ul className="space-y-2">
              {list.map((s) => (
                <li key={s.id}>
                  <ShiftChip
                    s={s}
                    showLocation={showLocation}
                    memberName={s.membershipId ? nameOf.get(s.membershipId) ?? "—" : t("openShift")}
                    onOpen={data.canEdit ? () => setEditor({ shift: s }) : undefined}
                    draggable={false}
                  />
                </li>
              ))}
            </ul>
          );
        })()}
      </div>

      {editor && <ShiftEditor key={editor.shift?.id ?? `${editor.date}-${editor.membershipId}`} data={data} seed={editor} onClose={() => setEditor(null)} />}
      {templatesOpen && <TemplatesDialog data={data} onClose={() => setTemplatesOpen(false)} />}

      {/* Publish confirmation lists every warning in the week (§5.1). */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("publishTitle", { date: dayLabel(data.weekStart, "long") })}</DialogTitle>
            <DialogDescription>{t("publishBody", { count: data.draftCount })}</DialogDescription>
          </DialogHeader>
          {weekWarnings.length > 0 ? (
            <div className="space-y-2" data-testid="publish-warnings">
              <p className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
                <TriangleAlert className="size-4" aria-hidden />
                {t("publishWarnings", { count: weekWarnings.length })}
              </p>
              <ul className="space-y-2 text-sm">
                {weekWarnings.map((s) => (
                  <li key={s.id} className="rounded-md border p-2">
                    <span className="font-medium">
                      {dayLabel(s.date)} {s.start}–{s.end} · {s.membershipId ? nameOf.get(s.membershipId) : t("openShift")}
                    </span>
                    <ul className="list-disc pl-5 text-amber-900 dark:text-amber-200">
                      {s.warnings.map((w, i) => (
                        <li key={i}>{warningText(tw, w)}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{t("publishAnyway")}</p>
            </div>
          ) : (
            <p className="text-sm">{t("publishNoWarnings")}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () => publishWeekAction(data.businessId, { weekStart: data.weekStart, locationIds: data.locations.map((l) => l.id) }),
                  () => {
                    setPublishOpen(false);
                    router.refresh();
                  },
                  { success: t("published") },
                )
              }
            >
              {t("confirmPublish")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
