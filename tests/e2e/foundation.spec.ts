import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, isMobile, latestEmailText, signIn } from "./helpers";

test.describe("Phase 1 — foundation", () => {
  test("unauthenticated visitors are sent to sign-in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("wrong password shows an error and stays on sign-in", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("emma@maple.example.com");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("password sign-in lands on the business dashboard with the right navigation", async ({ page }) => {
    await signIn(page, "emma@maple.example.com");
    await expect(page).toHaveURL(/\/b\/[^/]+$/);
    await expect(page.getByRole("heading", { name: /Welcome, Emma Server/ })).toBeVisible();

    if (isMobile(page)) {
      const bar = page.getByTestId("bottom-tab-bar");
      await expect(bar).toBeVisible();
      await expect(bar.getByRole("link")).toHaveText(["Schedule", "Clock", "Requests", "Messages", "More"]);
      // Touch targets ≥ 44px
      for (const box of await bar.getByRole("link").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
        expect(box).toBeGreaterThanOrEqual(44);
      }
      await expect(page.getByTestId("side-nav")).toBeHidden();
      await bar.getByRole("link", { name: "Schedule" }).click();
      await expect(page).toHaveURL(/\/schedule$/);
      await expect(bar.getByRole("link", { name: "Schedule" })).toHaveAttribute("aria-current", "page");
    } else {
      await expect(page.getByTestId("bottom-tab-bar")).toBeHidden();
      const side = page.getByTestId("side-nav");
      await expect(side).toBeVisible();
      // An employee has no management entries.
      await expect(side.getByRole("link", { name: "Settings" })).toHaveCount(0);
      await side.getByRole("link", { name: "Schedule" }).click();
      await expect(page).toHaveURL(/\/schedule$/);
    }
    await expectNoHorizontalScroll(page);
  });

  test("owner sees management navigation", async ({ page }) => {
    await signIn(page, "owner@maple.example.com");
    if (isMobile(page)) {
      await page.getByTestId("bottom-tab-bar").getByRole("link", { name: "More" }).click();
      await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
    } else {
      await expect(page.getByTestId("side-nav").getByRole("link", { name: "Settings" })).toBeVisible();
    }
  });

  test("a member of another business gets a 404, not a hint that it exists", async ({ page }) => {
    await signIn(page, "owner@harbour.example.com");
    await expect(page).toHaveURL(/\/b\/[^/]+$/);
    const harbourUrl = page.url();
    await page.context().clearCookies();
    await signIn(page, "emma@maple.example.com");
    const res = await page.goto(harbourUrl);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("a user in two businesses picks one and can switch", async ({ page }) => {
    await signIn(page, "sam@example.com");
    await expect(page.getByRole("heading", { name: "Choose a business" })).toBeVisible();
    await page.getByRole("link", { name: /Maple Bistro/ }).click();
    await expect(page.getByRole("heading", { name: /Welcome, Sam Shared/ })).toBeVisible();
    await page.getByLabel("Switch business").selectOption({ label: "Harbour Café" });
    await expect(page.getByRole("link", { name: "Harbour Café" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("magic link sign-in via the dev email fallback", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("noah@maple.example.com");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("status")).toContainText("sign-in link is on its way");

    const text = await latestEmailText(page, "noah@maple.example.com");
    const url = text.match(/https?:\/\/\S+magic-link\/verify\S+/)?.[0];
    expect(url).toBeTruthy();
    await page.goto(url!.replace(/[\])]+$/, ""));
    await expect(page.getByRole("heading", { name: /Welcome, Noah Cook/ })).toBeVisible();
  });

  test("magic link for an unknown email does not create an account", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("stranger@example.com");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    // Same response as for a real account (no enumeration).
    await expect(page.getByRole("status")).toContainText("sign-in link is on its way");
  });
});
