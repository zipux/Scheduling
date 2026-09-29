"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { CloudOff } from "lucide-react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Shown on every page while the device has no connection. */
export function OfflineBanner() {
  const t = useTranslations("offline");
  const offline = useSyncExternalStore(subscribe, () => !navigator.onLine, () => false);
  if (!offline) return null;
  return (
    <div role="status" data-testid="offline-banner" className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950">
      <CloudOff className="size-4 shrink-0" aria-hidden />
      {t("banner")}
    </div>
  );
}
