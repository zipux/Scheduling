import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, signIn, signInToBusiness } from "./helpers";

// King St, Maple Bistro
test.use({ geolocation: { latitude: 43.6487, longitude: -79.3817, accuracy: 20 }, permissions: ["geolocation"] });

test.describe("Phase 6 — time clock", () => {
  test("an employee clocks in with their PIN, takes a break and clocks out", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "personal clock is exercised on the phone; desktop covers offline");
    const base = await signInToBusiness(page, "clara@maple.example.com");
    await page.getByTestId("bottom-tab-bar").getByRole("link", { name: "Clock" }).click();
    await expect(page.getByTestId("clock-status")).toContainText("Clocked out");
    await expectNoHorizontalScroll(page);

    await page.getByLabel("Your PIN").fill("0000");
    await page.getByRole("button", { name: "Clock in", exact: true }).click();
    await expect(page.getByTestId("clock-error")).toContainText("PIN isn't right");

    await page.getByLabel("Your PIN").fill("2580");
    await page.getByRole("button", { name: "Clock in", exact: true }).click();
    await expect(page.getByTestId("clock-status")).toContainText("Clocked in");
    await page.getByLabel("Your PIN").fill("2580");
    await page.getByRole("button", { name: "Start break" }).click();
    await expect(page.getByTestId("clock-status")).toContainText("On break");
    await page.getByLabel("Your PIN").fill("2580");
    await page.getByRole("button", { name: "End break" }).click();
    await expect(page.getByTestId("clock-status")).toContainText("Clocked in");
    await page.getByLabel("Your PIN").fill("2580");
    await page.getByRole("button", { name: "Clock out", exact: true }).click();
    await expect(page.getByTestId("clock-status")).toContainText("Clocked out");
    // No shift was scheduled, so the entry is flagged for review.
    await expect(page.getByTestId("my-entries").getByRole("listitem").first()).toContainText("Unscheduled");
    expect(new URL(page.url()).pathname).toBe(`${base}/clock`);
  });

  test("offline: the punch is queued on the device and synced on reconnect", async ({ page, context }, info) => {
    test.skip(info.project.name !== "desktop", "one offline run");
    const base = await signInToBusiness(page, "omar@maple.example.com");
    await page.goto(`${base}/clock`);
    await expect(page.getByTestId("clock-status")).toContainText("Clocked out");
    await context.setOffline(true);
    await page.getByLabel("Your PIN").fill("1470");
    await page.getByRole("button", { name: "Clock in", exact: true }).click();
    await expect(page.getByTestId("offline-queue")).toContainText("1 punch waiting");
    await context.setOffline(false);
    await expect(page.getByText("Offline punch sent")).toBeVisible();
    await expect(page.getByTestId("clock-status")).toContainText("Clocked in");
    await expect(page.getByTestId("my-entries").getByRole("listitem").first()).toContainText("Offline punch");
  });

  test("a forgotten clock-out: the employee is asked when they finished — no time is invented", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "consumes seeded state");
    let base = await signInToBusiness(page, "noah@maple.example.com");
    await page.goto(`${base}/clock`);
    const q = page.getByTestId("previous-finish");
    await expect(q).toContainText("When did your last shift finish?");
    // Answer with a finish one hour after the (seeded) clock-in, whatever time the test runs.
    const [, hh, mm] = ((await q.getByRole("alert").first().textContent()) ?? "").match(/(\d{2}):(\d{2})/) ?? [];
    await q.getByLabel("Finish time").fill(`${String(Math.min(Number(hh) + 1, 23)).padStart(2, "0")}:${mm}`);
    await q.getByRole("button", { name: "Send to my manager" }).click();
    await expect(page.getByText("Sent. You can clock in now.")).toBeVisible();
    await expect(page.getByTestId("clock-panel")).toBeVisible();

    await page.context().clearCookies();
    base = await signInToBusiness(page, "manager@maple.example.com");
    await page.goto(`${base}/timeclock`);
    await expect(page.getByTestId("unresolved-time")).toContainText("Missing clock-in");
    const corr = page.getByTestId("pending-corrections").getByRole("listitem").filter({ hasText: "Noah Cook" });
    await corr.getByLabel("Reason").fill("Confirmed with Noah");
    await corr.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Correction applied.")).toBeVisible();
    await expect(page.getByTestId("pending-corrections")).toHaveCount(0);
  });

  test("a manager sees who is working and resolves an offline punch with a reason", async ({ page }) => {
    const base = await signInToBusiness(page, "manager@maple.example.com");
    await page.goto(`${base}/timeclock`);
    await expectNoHorizontalScroll(page);
    const row = page.getByTestId("unresolved-time").getByRole("listitem").filter({ hasText: "Leo Lead" }).first();
    if (await row.count()) {
      await row.getByRole("button", { name: "Confirm" }).click();
      await row.getByLabel("Reason").fill("Wi-Fi outage, times match the rota");
      await row.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Resolved.")).toBeVisible();
    }
  });

  test("kiosk: a manager enrols the tablet and is signed out; staff punch with a PIN; leaving needs a manager PIN", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "tablet flow");
    await signIn(page, "manager@maple.example.com");
    await page.goto("/kiosk/enrol");
    await page.getByLabel("Device name").fill("E2E tablet");
    await page.getByRole("button", { name: "Turn this device into a kiosk" }).click();
    await expect(page.getByRole("heading", { name: "Tap your name" })).toBeVisible();
    // The manager's session is gone from this device.
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in/);

    await page.goto("/kiosk");
    await page.getByTestId("kiosk-staff").getByRole("button", { name: "Pat Kiosk" }).click();
    for (const d of "3690") await page.getByRole("button", { name: d, exact: true }).click();
    await page.getByRole("button", { name: "OK" }).click();
    await page.getByRole("button", { name: "Clock in", exact: true }).click();
    await expect(page.getByTestId("kiosk-message")).toContainText("Pat Kiosk clocked in.");

    // An employee can't leave kiosk mode…
    await page.locator("summary", { hasText: "Leave kiosk mode" }).click();
    await page.getByRole("button", { name: "Pat Kiosk" }).last().click();
    for (const d of "3690") await page.getByRole("button", { name: d, exact: true }).click();
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("kiosk-message")).toContainText("Only a manager");
    // …a manager can.
    await page.locator("summary", { hasText: "Leave kiosk mode" }).click();
    await page.getByRole("button", { name: "Marco Manager" }).last().click();
    for (const d of "3333") await page.getByRole("button", { name: d, exact: true }).click();
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/kiosk");
    await expect(page.getByRole("heading", { name: "This device isn't a kiosk" })).toBeVisible();
  });
});
