"use client";

import { useEffect } from "react";

/**
 * Registers the offline-shell service worker (public/sw.js). Production only,
 * unless NEXT_PUBLIC_SW=1 (the e2e suite sets it to test offline behaviour).
 */
const ENABLED = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_SW === "1";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!ENABLED || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      /* unsupported or blocked: the app works without it */
    });
  }, []);
  return null;
}

function post(message: Record<string, unknown>) {
  if (!ENABLED || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage(message)).catch(() => {});
}

/** Keeps an offline copy of this business's clock page (throttled by the worker unless forced). */
export function warmClockPage(businessId: string, force = false) {
  post({ type: "warm-clock", path: `/b/${businessId}/clock`, force });
}

/** Removes cached pages (they hold the signed-in user's details). */
export async function clearOfflinePages() {
  post({ type: "clear-pages" });
  try {
    for (const key of await caches.keys()) if (key.startsWith("shiftwise-pages-")) await caches.delete(key);
  } catch {
    /* Cache API unavailable */
  }
}

/** Mount inside a business: caches that business's clock page for offline use. */
export function WarmClockPage({ businessId }: { businessId: string }) {
  useEffect(() => warmClockPage(businessId), [businessId]);
  return null;
}
