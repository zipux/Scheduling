"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Pulse = { messages: number; announcements: number; notifications: number };
const Ctx = createContext<Pulse>({ messages: 0, announcements: 0, notifications: 0 });

const POLL_MS = 10_000;

/** Polls unread counts for the shell's badges (§2: polling, no extra infrastructure). */
export function PulseProvider({ businessId, children }: { businessId: string; children: React.ReactNode }) {
  const [pulse, setPulse] = useState<Pulse>({ messages: 0, announcements: 0, notifications: 0 });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch(`/api/b/${businessId}/pulse`, { cache: "no-store" });
        if (r.ok && alive) setPulse(await r.json());
      } catch {
        /* offline — keep the last counts */
      }
    };
    const first = setTimeout(load, 0);
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [businessId]);
  return <Ctx.Provider value={pulse}>{children}</Ctx.Provider>;
}

export function usePulse() {
  return useContext(Ctx);
}

export function CountBadge({ count, label }: { count: number; label: string }) {
  if (!count) return null;
  return (
    <span className="absolute -top-1 -right-2 min-w-5 rounded-full bg-destructive px-1 text-center text-[10px] leading-5 font-semibold text-white" aria-label={label} data-testid="count-badge">
      {count > 99 ? "99+" : count}
    </span>
  );
}
