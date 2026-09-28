"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/app/native-select";
import { useAction } from "@/components/app/use-action";
import { changeRoleAction, deactivateAction, reactivateAction, resetPinAction } from "../actions";

export function MemberAdmin(props: {
  businessId: string;
  membershipId: string;
  roleId: string;
  roles: { id: string; name: string }[];
  deactivated: boolean;
  hasPin: boolean;
}) {
  const t = useTranslations("people");
  const router = useRouter();
  const { pending, run } = useAction();
  const [roleId, setRoleId] = useState(props.roleId);
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const refresh = () => router.refresh();
  const b = props.businessId;
  const id = props.membershipId;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-medium">{t("role")}</h2>
        <div className="flex flex-wrap gap-2">
          <NativeSelect aria-label={t("role")} className="w-auto min-w-48 flex-1" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {!props.roles.some((r) => r.id === props.roleId) && <option value={props.roleId}>—</option>}
            {props.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
          <Button
            disabled={pending || roleId === props.roleId}
            onClick={() => run(() => changeRoleAction(b, { membershipId: id, roleId }), refresh, { success: t("saved") })}
          >
            {t("changeRole")}
          </Button>
        </div>
      </section>
      {props.hasPin && (
        <section className="space-y-2">
          <h2 className="font-medium">{t("pin")}</h2>
          <p className="text-sm text-muted-foreground">{t("resetPinHint")}</p>
          <Button variant="outline" disabled={pending} onClick={() => run(() => resetPinAction(b, { membershipId: id }), refresh, { success: t("pinResetDone") })}>
            {t("resetPin")}
          </Button>
        </section>
      )}
      <section className="space-y-2">
        <h2 className="font-medium">{props.deactivated ? t("reactivate") : t("deactivate")}</h2>
        {props.deactivated ? (
          <Button disabled={pending} onClick={() => run(() => reactivateAction(b, { membershipId: id }), refresh, { success: t("saved") })}>
            {t("reactivate")}
          </Button>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("deactivateHint")}</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="endDate">{t("employmentEnded")}</Label>
                <Input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  run(() => deactivateAction(b, { membershipId: id, employmentEndedAt: endDate || null }), refresh, { success: t("deactivatedDone") })
                }
              >
                {t("deactivate")}
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
