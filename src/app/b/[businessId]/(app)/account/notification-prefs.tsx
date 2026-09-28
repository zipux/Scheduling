"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SwitchField } from "@/components/app/form-fields";
import { useAction } from "@/components/app/use-action";
import { setPreferenceAction } from "../messages/actions";

export function NotificationPrefs({ businessId, prefs }: { businessId: string; prefs: { type: string; email: boolean }[] }) {
  const t = useTranslations("notifications");
  const { run } = useAction();
  const [state, setState] = useState(prefs);
  return (
    <div className="space-y-1" data-testid="notification-prefs">
      {state.map((p) => (
        <SwitchField
          key={p.type}
          label={t(`types.${p.type.replace(".", "_")}`)}
          checked={p.email}
          onChange={(email) => {
            setState((s) => s.map((x) => (x.type === p.type ? { ...x, email } : x)));
            run(() => setPreferenceAction(businessId, { type: p.type as never, email }));
          }}
        />
      ))}
    </div>
  );
}
