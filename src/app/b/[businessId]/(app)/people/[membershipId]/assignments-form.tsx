"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAction } from "@/components/app/use-action";
import { setAssignmentsAction } from "../actions";

type Opt = { id: string; name: string };

export function AssignmentsForm(props: {
  businessId: string;
  membershipId: string;
  locations: Opt[];
  positions: Opt[];
  locationIds: string[];
  positionIds: string[];
}) {
  const t = useTranslations("people");
  const router = useRouter();
  const { pending, run } = useAction();
  const [loc, setLoc] = useState(props.locationIds);
  const [pos, setPos] = useState(props.positionIds);
  const list = (legend: string, opts: Opt[], value: string[], set: (v: string[]) => void) => (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="grid sm:grid-cols-2">
        {opts.map((o) => (
          <label key={o.id} className="flex min-h-11 items-center gap-3">
            <Checkbox className="size-5" checked={value.includes(o.id)} onCheckedChange={(c) => set(c ? [...value, o.id] : value.filter((x) => x !== o.id))} />
            {o.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setAssignmentsAction(props.businessId, { membershipId: props.membershipId, locationIds: loc, positionIds: pos }), () => router.refresh(), {
          success: t("saved"),
        });
      }}
    >
      {list(t("locations"), props.locations, loc, setLoc)}
      {list(t("positions"), props.positions, pos, setPos)}
      <Button type="submit" disabled={pending}>
        {t("saveAssignments")}
      </Button>
    </form>
  );
}
