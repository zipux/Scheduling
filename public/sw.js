/*
 * Shiftwise service worker — offline shell (Spec §2, §7.1).
 *
 * Network first, always: while online every request goes to the server as if
 * this worker weren't here (the browser's HTTP cache still applies), so nothing
 * is ever served stale. Copies are kept only for when the network fails:
 *   - the personal time clock page and the assets it needs, so staff can open
 *     it offline and punch — punches go to the device queue
 *     (src/components/app/punch-queue.ts) and sync on reconnect;
 *   - /offline, shown for any other page opened without a connection;
 *   - static assets fetched while online.
 * Server actions, RSC fetches, API routes and non-GET requests are never touched.
 *
 * The app asks for the clock page to be cached ("warm") because in-app
 * navigation never produces a full page load the worker could copy.
 *
 * The cached clock page holds the signed-in user's name and status, so the page
 * cache is emptied on sign-out and whenever the sign-in page loads.
 */

const VERSION = "v1";
const STATIC_CACHE = `shiftwise-static-${VERSION}`;
const PAGE_CACHE = `shiftwise-pages-${VERSION}`;
const OFFLINE_URL = "/offline";
const LAST_CLOCK_KEY = "/__last-clock";
const STATIC_LIMIT = 300;
const WARM_EVERY_MS = 60_000;

const CLOCK_PAGE = /^\/b\/[^/]+\/clock$/;
const STATIC_ASSET = /^\/(_next\/static\/|icons\/|manifest\.webmanifest$|favicon\.ico$)/;
const lastWarm = new Map();

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await cacheWithAssets(OFFLINE_URL, STATIC_CACHE);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, PAGE_CACHE]);
      for (const key of await caches.keys()) if (key.startsWith("shiftwise-") && !keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const msg = event.data ?? {};
  if (msg.type === "clear-pages") {
    lastWarm.clear();
    event.waitUntil(caches.delete(PAGE_CACHE));
  } else if (msg.type === "warm-clock" && typeof msg.path === "string" && CLOCK_PAGE.test(msg.path)) {
    const now = Date.now();
    if (!msg.force && now - (lastWarm.get(msg.path) ?? 0) < WARM_EVERY_MS) return;
    lastWarm.set(msg.path, now);
    event.waitUntil(warmClock(msg.path).catch(() => {}));
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") return event.respondWith(navigate(req, url));
  if (STATIC_ASSET.test(url.pathname) && !req.headers.has("RSC")) return event.respondWith(staticAsset(req));
});

/** Copy of a response that can answer a navigation (redirected responses can't). */
async function clean(res) {
  if (!res.redirected) return res.clone();
  const body = await res.clone().blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** Static asset URLs referenced by an HTML document (scripts, stylesheets, icons). */
function assetsIn(html) {
  const found = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/(?:_next\/static|icons)\/[^"]+)"/g)) found.add(m[1].replace(/&amp;/g, "&"));
  return [...found];
}

/** Fetches a page and every static asset it references into `cacheName`. */
async function cacheWithAssets(path, cacheName) {
  const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) return null;
  const copy = await clean(res);
  const html = await res.clone().text();
  const statics = await caches.open(STATIC_CACHE);
  await Promise.all(
    assetsIn(html).map(async (a) => {
      if (await statics.match(a)) return;
      try {
        const r = await fetch(a);
        if (r.ok) await statics.put(a, r);
      } catch {
        /* best effort */
      }
    }),
  );
  await (await caches.open(cacheName)).put(path, copy.clone());
  return { res, copy };
}

async function warmClock(path) {
  const out = await cacheWithAssets(path, PAGE_CACHE);
  if (!out) return;
  const finalPath = new URL(out.res.url || path, self.location.origin).pathname;
  if (finalPath !== path) {
    // Signed out or lost access: don't keep whatever we were redirected to.
    await (await caches.open(PAGE_CACHE)).delete(path);
    return;
  }
  await (await caches.open(PAGE_CACHE)).put(LAST_CLOCK_KEY, out.copy);
}

async function navigate(req, url) {
  try {
    const res = await fetch(req);
    const finalPath = new URL(res.url || req.url).pathname;
    if (finalPath === "/sign-in") {
      lastWarm.clear();
      await caches.delete(PAGE_CACHE);
    } else if (res.ok && CLOCK_PAGE.test(finalPath)) {
      const cache = await caches.open(PAGE_CACHE);
      const copy = await clean(res);
      await cache.put(finalPath, copy.clone());
      await cache.put(LAST_CLOCK_KEY, copy);
    }
    return res;
  } catch {
    const pages = await caches.open(PAGE_CACHE);
    const exact = await pages.match(url.pathname);
    if (exact) return exact;
    // The home screen shortcut and start URL go through /clock or / — both
    // lead to a clock page online, so offline they open the last one cached.
    if (url.pathname === "/clock" || url.pathname === "/") {
      const last = await pages.match(LAST_CLOCK_KEY);
      if (last) return last;
    }
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

async function staticAsset(req) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      void trim(cache);
    }
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw new Error("offline and not cached");
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  // Keys come back in insertion order (oldest first); the offline page stays.
  for (const key of keys.slice(0, Math.max(0, keys.length - STATIC_LIMIT))) {
    if (new URL(key.url).pathname !== OFFLINE_URL) await cache.delete(key);
  }
}
