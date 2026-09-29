import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, isMobile, signIn, signInToBusiness } from "./helpers";

/** Waits until the service worker controls the page and holds an offline copy of `path`. */
async function waitForOfflineCopy(page: Page, path: string) {
  await expect
    .poll(
      () =>
        page.evaluate(async (p) => {
          if (!navigator.serviceWorker.controller) return false;
          const keys = await caches.keys();
          for (const k of keys) if (k.startsWith("shiftwise-pages-") && (await (await caches.open(k)).match(p))) return true;
          return false;
        }, path),
      { timeout: 30_000 },
    )
    .toBe(true);
}

test.describe("Phase 9 — polish", () => {
  test("PWA: the manifest is served with icons and a clock shortcut", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m.display).toBe("standalone");
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(m.shortcuts[0].url).toBe("/clock");
    for (const icon of m.icons) expect((await request.get(icon.src)).ok()).toBe(true);
    const sw = await request.get("/sw.js");
    expect(sw.headers()["cache-control"]).toContain("no-cache");
  });

  test("offline shell: the clock opens and punches without a connection; other pages show the offline page", async ({ page, context }, info) => {
    test.skip(info.project.name !== "mobile", "one offline run, on the phone");
    const base = await signInToBusiness(page, "lead@maple.example.com");
    // The dashboard asks the worker to keep the clock page, without ever visiting it.
    await waitForOfflineCopy(page, `${base}/clock`);

    await context.setOffline(true);
    await page.goto(`${base}/clock`);
    await expect(page.getByTestId("clock-status")).toContainText("Clocked out");

    // A page that isn't kept offline gets the offline page, which leads back to the clock.
    await page.goto(`${base}/reports`);
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole("link", { name: "Open the time clock" }).click();
    await expect(page.getByTestId("clock-status")).toBeVisible();

    // `next dev` loads its hot-reload client at runtime, so a cached page can't start
    // its scripts offline there; punching from the cached page is checked against a
    // production build (npm run test:e2e:prod).
    if (process.env.E2E_PROD !== "1") return;
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await page.getByLabel("Your PIN").fill("5555");
    await page.getByRole("button", { name: "Clock in", exact: true }).click();
    await expect(page.getByTestId("offline-queue")).toContainText("1 punch waiting");

    // Reconnecting fires `online`: the page syncs the queue by itself.
    await context.setOffline(false);
    await expect(page.getByText("Offline punch sent")).toBeVisible();
    await expect(page.getByTestId("clock-status")).toContainText("Clocked in");
    await expect(page.getByTestId("offline-banner")).toBeHidden();
    // Leave Leo clocked out for the rest of the suite.
    await page.getByLabel("Your PIN").fill("5555");
    await page.getByRole("button", { name: "Clock out", exact: true }).click();
    await expect(page.getByTestId("clock-status")).toContainText("Clocked out");
  });

  test("signing out removes the cached clock page from the device", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "service worker behaviour, once");
    const base = await signInToBusiness(page, "lead@maple.example.com");
    await waitForOfflineCopy(page, `${base}/clock`);
    await page.goto(`${base}/more`);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    const left = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((k) => k.startsWith("shiftwise-pages-"));
      let n = 0;
      for (const k of names) n += (await (await caches.open(k)).keys()).length;
      return n;
    });
    expect(left).toBe(0);
  });

  test("export my data: own messages with text, received ones as metadata only", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one download");
    const base = await signInToBusiness(page, "emma@maple.example.com");
    await page.goto(`${base}/account`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-my-data").click()]);
    expect(download.suggestedFilename()).toMatch(/^my-data-\d{4}-\d{2}-\d{2}\.json$/);
    const raw = await readFile((await download.path())!, "utf8");
    const data = JSON.parse(raw);
    expect(data.user.email).toBe("emma@maple.example.com");
    const maple = data.businesses.find((b: { business: { name: string } }) => b.business.name === "Maple Bistro");
    expect(maple.messagesSent.map((m: { body: string }) => m.body)).toContain("Yes, happy to.");
    expect(maple.messagesReceived.length).toBeGreaterThan(0);
    expect(maple.messagesReceived[0]).not.toHaveProperty("body");
    // Nothing anybody else wrote, anywhere in the file.
    expect(raw).not.toContain("Can you cover the patio on Friday?");
    expect(raw).not.toContain("New fryer arrives Tuesday");
    expect(raw).not.toContain("pinHmac");
  });

  test("request account deletion, seen by the platform admin, then cancel it", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "changes account state");
    const base = await signInToBusiness(page, "gm@maple.example.com");
    await page.goto(`${base}/account`);
    await page.getByRole("button", { name: "Request account deletion" }).click();
    await page.getByRole("button", { name: "Yes, request deletion" }).click();
    await expect(page.getByTestId("deletion-requested")).toContainText("You asked for your account to be deleted");
    await expectNoHorizontalScroll(page);

    await page.context().clearCookies();
    await signIn(page, "admin@example.com");
    await page.goto("/admin");
    await expect(page.getByTestId("deletion-requests")).toContainText("gm@maple.example.com");

    await page.context().clearCookies();
    await signInToBusiness(page, "gm@maple.example.com");
    await page.goto(`${base}/account`);
    await page.getByRole("button", { name: "Cancel the request" }).click();
    await expect(page.getByText("Deletion request cancelled.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Request account deletion" })).toBeVisible();
  });

  test("keyboard: the skip link jumps past the navigation to the page content", async ({ page }) => {
    const base = await signInToBusiness(page, "emma@maple.example.com");
    await page.goto(`${base}/requests`);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("empty states explain what to do next", async ({ page }) => {
    const base = await signInToBusiness(page, "owner@harbour.example.com", undefined, /Harbour/);
    await page.goto(`${base}/settings/blackouts`);
    await expect(page.getByText("No upcoming blackout dates")).toBeVisible();
    if (isMobile(page)) await expectNoHorizontalScroll(page);
  });
});
