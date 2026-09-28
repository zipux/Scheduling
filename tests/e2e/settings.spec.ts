import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, signInToBusiness } from "./helpers";

test.use({ geolocation: { latitude: 43.6487, longitude: -79.3817, accuracy: 30 }, permissions: ["geolocation"] });

test.describe("Phase 3 — locations, positions & wages", () => {
  test("owner adds a location using their position and the geofence test tool", async ({ page }, info) => {
    const name = `Pop-up ${info.project.name} ${Date.now().toString(36)}`;
    const base = await signInToBusiness(page, "owner@maple.example.com");
    await page.goto(`${base}/settings`);
    await page.getByRole("link", { name: /Locations/ }).click();
    await expect(page.getByTestId("location-list")).toContainText("King St");
    await page.getByRole("link", { name: "New location" }).click();
    await page.getByLabel("Location name").fill(name);
    await page.getByRole("button", { name: "Use my current position" }).click();
    await expect(page.getByLabel("Latitude")).toHaveValue("43.648700");
    await expect(page.getByRole("application", { name: /Map/ })).toBeVisible();
    await page.getByRole("button", { name: /Test geofence/ }).click();
    const status = page.getByTestId("geofence-test").getByRole("status");
    await expect(status).toContainText("Recommended radius: 40 m", { timeout: 30_000 });
    await status.getByRole("button", { name: "Use this radius" }).click();
    await expect(page.getByLabel("Radius (metres)")).toHaveValue("40");
    await page.getByRole("switch", { name: "Temporary venue" }).click();
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: "Create location" }).click();
    const row = page.getByTestId("location-list").getByRole("link", { name: new RegExp(name) });
    await expect(row).toContainText("40 m");
    await expect(row).toContainText("Temporary");
  });

  test("owner adds a position with a minimum age", async ({ page }, info) => {
    const name = `Sommelier ${info.project.name}`;
    const base = await signInToBusiness(page, "owner@maple.example.com");
    await page.goto(`${base}/settings/positions`);
    await page.getByRole("button", { name: "New position" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Minimum age").fill("19");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByTestId("position-list")).toContainText(name);
    await expect(page.getByTestId("position-list").getByRole("listitem").filter({ hasText: name })).toContainText("19+");
    await expectNoHorizontalScroll(page);
  });

  test("owner changes time clock rules and sees the rounding warning", async ({ page }) => {
    const base = await signInToBusiness(page, "owner@maple.example.com");
    await page.goto(`${base}/settings/business`);
    await expect(page.getByText(/Rounding is off by default/)).toBeVisible();
    await page.getByLabel("Late / early-leave tolerance (minutes)").fill("6");
    await page.getByRole("form").or(page.locator("form")).nth(2).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.").first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Late / early-leave tolerance (minutes)")).toHaveValue("6");
    await expectNoHorizontalScroll(page);
  });

  test("owner gives an employee a raise; the employee sees it in My pay", async ({ page }, info) => {
    const amount = info.project.name === "mobile" ? "19.10" : "19.20";
    const base = await signInToBusiness(page, "owner@maple.example.com");
    await page.goto(`${base}/people`);
    await page.getByTestId("member-list").getByRole("link", { name: /Liam Host/ }).click();
    await expect(page.getByTestId("wage-history")).toContainText("$17.50");
    await page.getByLabel(/Rate per hour/).fill(amount);
    await page.getByLabel("Effective from").fill("2026-12-01");
    await page.getByRole("button", { name: "Add wage" }).click();
    await expect(page.getByTestId("wage-history")).toContainText(`$${amount}`);
    await expect(page.getByTestId("wage-history")).toContainText("starts 2026-12-01");
    await expectNoHorizontalScroll(page);

    await page.context().clearCookies();
    const eb = await signInToBusiness(page, "liam@maple.example.com");
    await page.goto(`${eb}/account`);
    await expect(page.getByTestId("wage-history")).toContainText(`$${amount}`);
  });

  test("a manager can see wages but has no wage form; an employee cannot open someone else's page", async ({ page }) => {
    const base = await signInToBusiness(page, "manager@maple.example.com");
    await page.goto(`${base}/people`);
    await page.getByTestId("member-list").getByRole("link", { name: /Mia Bartender/ }).click();
    await expect(page.getByTestId("wage-history")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add wage" })).toHaveCount(0);
    const memberUrl = page.url();

    await page.context().clearCookies();
    await signInToBusiness(page, "noah@maple.example.com");
    const res = await page.goto(memberUrl);
    expect(res?.status()).toBe(404);
  });
});
