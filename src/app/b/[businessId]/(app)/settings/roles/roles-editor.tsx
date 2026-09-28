"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { FieldError } from "@/components/app/field-error";
import { useAction } from "@/components/app/use-action";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { createRoleAction, deleteRoleAction, updateRoleAction } from "./actions";

interface RoleRow {
  id: string;
  name: string;
  rank: number;
  isOwner: boolean;
  members: number;
  permissions: Permission[];
}

function RoleForm(props: {
  businessId: string;
  role?: RoleRow;
  actorRank: number;
  grantable: Permission[];
  onDone: () => void;
}) {
  const t = useTranslations("settings.roles");
  const tp = useTranslations("permissions");
  const { pending, fieldErrors, run } = useAction();
  const [name, setName] = useState(props.role?.name ?? "");
  const [rank, setRank] = useState(String(props.role?.rank ?? Math.max(props.actorRank + 1, 2)));
  const [perms, setPerms] = useState<Permission[]>(props.role?.permissions ?? []);
  const readOnly = !!props.role?.isOwner;

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const input = { name, rank: Number(rank), permissions: perms };
        run(
          () => (props.role ? updateRoleAction(props.businessId, { ...input, roleId: props.role.id }) : createRoleAction(props.businessId, input)),
          props.onDone,
          { success: t("saved") },
        );
      }}
    >
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-2">
          <Label htmlFor={`name-${props.role?.id ?? "new"}`}>{t("name")}</Label>
          <Input id={`name-${props.role?.id ?? "new"}`} value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} />
          <FieldError errors={fieldErrors.name} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`rank-${props.role?.id ?? "new"}`}>{t("rank")}</Label>
          <Input id={`rank-${props.role?.id ?? "new"}`} inputMode="numeric" value={rank} disabled={readOnly} onChange={(e) => setRank(e.target.value)} />
          <FieldError errors={fieldErrors.rank} />
        </div>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">{t("permissions")}</legend>
        <FieldError errors={fieldErrors.permissions} />
        <ul className="grid gap-x-4 sm:grid-cols-2">
          {PERMISSIONS.map((p) => {
            const disabled = readOnly || !props.grantable.includes(p);
            return (
              <li key={p}>
                <label className={`flex min-h-11 items-center gap-3 ${disabled ? "opacity-60" : ""}`}>
                  <Checkbox
                    className="size-5"
                    checked={perms.includes(p)}
                    disabled={disabled}
                    onCheckedChange={(c) => setPerms((s) => (c ? [...s, p] : s.filter((x) => x !== p)))}
                  />
                  <span className="text-sm">
                    <span className="block">{tp(`${p.replace(".", "_")}`)}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">{p}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {props.role ? t("save") : t("create")}
          </Button>
          <Button type="button" variant="ghost" onClick={props.onDone}>
            {t("cancel")}
          </Button>
        </div>
      )}
    </form>
  );
}

export function RolesEditor(props: { businessId: string; actorRank: number; grantable: Permission[]; roles: RoleRow[] }) {
  const t = useTranslations("settings.roles");
  const router = useRouter();
  const { pending, run } = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const done = () => {
    setOpen(null);
    router.refresh();
  };
  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-lg border" data-testid="role-list">
        {props.roles.map((r) => {
          const editable = !r.isOwner && r.rank > props.actorRank;
          return (
            <li key={r.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-sm text-muted-foreground">{r.rank}</span>
                <span className="min-w-0 flex-1 font-medium">{r.name}</span>
                <Badge variant="outline">{t("memberCount", { count: r.members })}</Badge>
                {r.isOwner && <Lock className="size-4 text-muted-foreground" aria-label={t("locked")} />}
                <Button size="sm" variant="outline" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  {editable ? t("edit") : t("view")}
                </Button>
                {editable && r.members === 0 && (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteRoleAction(props.businessId, { roleId: r.id }), done, { success: t("deleted") })}>
                    {t("delete")}
                  </Button>
                )}
              </div>
              {open === r.id && (
                <div className="mt-3">
                  <RoleForm
                    businessId={props.businessId}
                    role={editable ? r : { ...r, isOwner: true }}
                    actorRank={props.actorRank}
                    grantable={props.grantable}
                    onDone={done}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {open === "new" ? (
        <div className="rounded-lg border p-4">
          <RoleForm businessId={props.businessId} actorRank={props.actorRank} grantable={props.grantable} onDone={done} />
        </div>
      ) : (
        <Button onClick={() => setOpen("new")}>
          <Plus aria-hidden />
          {t("newRole")}
        </Button>
      )}
    </div>
  );
}
