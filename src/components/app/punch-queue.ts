"use client";

/**
 * Offline punch queue (§7.1). Punches made while offline are kept on the device
 * with the device timestamp and the last known GPS fix, and synced on reconnect.
 * Storage failures (private mode) degrade to "no queue", never to a crash.
 */

export interface QueuedPunch {
  id: string;
  action: "in" | "break_start" | "break_end" | "out";
  deviceTime: string;
  position: { lat: number; lng: number; accuracy: number } | null;
}

const key = (businessId: string) => `punch-queue:${businessId}`;
const FIX_KEY = "last-fix";

function read<T>(k: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export function queued(businessId: string): QueuedPunch[] {
  return read<QueuedPunch[]>(key(businessId), []);
}

export function enqueue(businessId: string, p: Omit<QueuedPunch, "id">) {
  const list = queued(businessId);
  list.push({ ...p, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` });
  write(key(businessId), list);
}

export function dequeue(businessId: string, id: string) {
  write(key(businessId), queued(businessId).filter((p) => p.id !== id));
}

export function rememberFix(fix: QueuedPunch["position"]) {
  if (fix) write(FIX_KEY, { ...fix, at: Date.now() });
}

export function lastFix(): QueuedPunch["position"] {
  const f = read<(QueuedPunch["position"] & { at: number }) | null>(FIX_KEY, null);
  return f ? { lat: f.lat, lng: f.lng, accuracy: f.accuracy } : null;
}

/** Current position, or null if unavailable/denied (the server decides what that means). */
export function currentPosition(timeoutMs = 10_000): Promise<{ fix: QueuedPunch["position"]; denied: boolean }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return resolve({ fix: null, denied: false });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
        rememberFix(fix);
        resolve({ fix, denied: false });
      },
      (e) => resolve({ fix: null, denied: e.code === e.PERMISSION_DENIED }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}
