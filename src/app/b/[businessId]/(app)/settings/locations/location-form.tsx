"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { LocationFields, type LocationValues } from "@/components/app/location-fields";
import { useAction } from "@/components/app/use-action";
import { archiveLocationAction, createLocationAction, updateLocationAction } from "../actions";

export function LocationForm(props: {
  businessId: string;
  id?: string;
  archived?: boolean;
  initial: LocationValues;
  timezones: string[];
}) {
  const t = useTranslations("settings.locations");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [v, setV] = useState(props.initial);
  const list = `/b/${props.businessId}/settings/locations`;

  return (
    <form
      noValidate
      className="max-w-lg space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (props.id) {
          run(() => updateLocationAction(props.businessId, { id: props.id!, location: v as never }), () => router.refresh(), {
            success: t("saved"),
          });
        } else {
          run(() => createLocationAction(props.businessId, v as never), () => router.push(list), { success: t("created") });
        }
      }}
    >
      <LocationFields value={v} onChange={setV} errors={fieldErrors} timezones={props.timezones} prefix={props.id ? "location." : ""} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {props.id ? t("save") : t("create")}
        </Button>
        {props.id && (
          <Button
            type="button"
            size="lg"
            variant={props.archived ? "outline" : "ghost"}
            disabled={pending}
            onClick={() =>
              run(() => archiveLocationAction(props.businessId, { id: props.id!, archived: !props.archived }), () => router.push(list), {
                success: props.archived ? t("restored") : t("archivedDone"),
              })
            }
          >
            {props.archived ? t("restore") : t("archive")}
          </Button>
        )}
      </div>
    </form>
  );
}
