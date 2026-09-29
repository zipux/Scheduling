import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { isMobile, signIn, signInToBusiness } from "./helpers";

/**
 * Phase 9 accessibility pass (Spec §11: WCAG 2.1 AA basics). Every screen is
 * scanned with axe on mobile and desktop, and must also fit without horizontal
 * scroll. The seeded data puts real content on each page.
 */

async function scan(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.locator("h1").first()).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // Leaflet's third-party map tiles are decorative; the lat/lng inputs are the accessible control.
    .exclude(".leaflet-container")
    .analyze();
  const summary = violations.map((v) => `${path} — ${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 5).map((n) => n.target.join(" ")).join("\n  ")}`);
  // Soft: one run reports every page's problems, not just the first.
  expect.soft(summary, summary.join("\n")).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect.soft(overflow, `${path}: horizontal scroll`).toBeLessThanOrEqual(0);
  if (isMobile(page)) expect.soft(await smallTargets(page), `${path}: touch targets under 44 px`).toEqual([]);
}

/**
 * Spec §11: touch targets ≥ 44 px on mobile. Exempt, as in WCAG 2.5.8: links
 * inside running text, and controls whose visible label is itself the target
 * (checkboxes/switches wrapped in or pointed at by a <label> of that size).
 */
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const MIN = 44;
    const out: string[] = [];
    const sel = "a[href], button, input:not([type=hidden]), select, textarea, [role=tab], [role=checkbox], [role=switch], summary";
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || el.closest("[aria-hidden=true], .leaflet-container, .sr-only")) continue;
      if (el.tagName === "A" && cs.display === "inline") continue;
      const label = el.closest("label") ?? (el.id ? document.querySelector<HTMLElement>(`label[for="${CSS.escape(el.id)}"]`) : null);
      const box = label && label.getBoundingClientRect().height >= MIN ? label.getBoundingClientRect() : r;
      if (box.height < MIN - 0.5 || box.width < MIN - 0.5) {
        const name = (el.getAttribute("aria-label") ?? el.textContent ?? el.getAttribute("name") ?? "").trim().slice(0, 40);
        out.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(box.width)}×${Math.round(box.height)}`);
      }
    }
    return out;
  });
}

/** First link on the page whose href matches, as a path. */
async function firstHref(page: Page, path: string, pattern: RegExp) {
  await page.goto(path);
  const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  const href = hrefs.find((h) => pattern.test(h));
  expect(href, `no link matching ${pattern} on ${path}`).toBeTruthy();
  return href!;
}

test.describe("Phase 9 — accessibility", () => {
  test("signed-out pages", async ({ page }) => {
    await scan(page, "/sign-in");
    await scan(page, "/offline");
    await scan(page, "/does-not-exist");
  });

  test("owner: every business screen", async ({ page }) => {
    test.setTimeout(240_000);
    const base = await signInToBusiness(page, "owner@maple.example.com");
    const pages = [
      "",
      "/schedule",
      "/clock",
      "/requests",
      "/messages",
      "/more",
      "/account",
      "/people",
      "/people/invite",
      "/timeclock",
      "/timesheets",
      "/reports",
      "/settings",
      "/settings/business",
      "/settings/locations",
      "/settings/locations/new",
      "/settings/positions",
      "/settings/roles",
      "/settings/pay-rules",
      "/settings/holidays",
      "/settings/blackouts",
      "/settings/kiosks",
    ];
    for (const p of pages) await scan(page, `${base}${p}`);
    await scan(page, await firstHref(page, `${base}/people`, /\/people\/(?!invite)[^/]+$/));
    await scan(page, await firstHref(page, `${base}/timesheets`, /\/timesheets\/(?!export)[^/?]+/));
    await scan(page, await firstHref(page, `${base}/settings/locations`, /\/settings\/locations\/(?!new)[^/]+$/));
  });

  test("employee: every screen they can reach", async ({ page }) => {
    const base = await signInToBusiness(page, "emma@maple.example.com");
    for (const p of ["", "/schedule", "/clock", "/requests", "/messages", "/more", "/account"]) await scan(page, `${base}${p}`);
    // Seeded DM with the manager.
    await scan(page, await firstHref(page, `${base}/messages`, /\/messages\/[^/]+$/));
    await scan(page, "/me/hours");
  });

  test("platform admin", async ({ page }) => {
    await signIn(page, "admin@example.com");
    await scan(page, "/admin");
    await scan(page, "/admin/new");
    await scan(page, await firstHref(page, "/admin", /\/admin\/businesses\/[^/]+$/));
  });

  test("multi-business chooser", async ({ page }) => {
    await signIn(page, "sam@example.com");
    await scan(page, "/");
  });
});
