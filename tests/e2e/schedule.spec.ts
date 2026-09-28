import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, isMobile, signInToBusiness } from "./helpers";

function mondayOf(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}
function addDays(key: string, n: number) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function openSchedule(page: Page, base: string, query = "") {
  await page.goto(`${base}/schedule${query}`);
  await expect(page.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
}

test.describe("Phase 4 — scheduling", () => {
  test("owner assigns a 17-year-old to the Bar: the warning shows at assignment, on the shift and at publish", async ({ page }, info) => {
    const base = await signInToBusiness(page, "owner@maple.example.com");
    const week = addDays(mondayOf(new Date()), 14 + (info.project.name === "mobile" ? 0 : 7));
    await openSchedule(page, base, `?week=${week}&loc=all`);
    await expectNoHorizontalScroll(page);

    await page.getByRole("button", { name: "Add shift", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Date").fill(addDays(week, 2));
    await dialog.getByLabel("Start").fill("18:00");
    await dialog.getByLabel("End", { exact: true }).fill("23:00");
    // "All locations" is selected, so location has no default (§5.2).
    await expect(dialog.getByLabel("Location")).toHaveValue("");
    await dialog.getByLabel("Location").selectOption({ label: "King St" });
    await dialog.getByLabel("Position").selectOption({ label: "Bar" });
    await dialog.getByLabel("Employee").selectOption({ label: "Liam Host" });
    await expect(dialog.getByTestId("editor-warnings")).toContainText("Below the minimum age for this position (17; needs 18)");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Shift created.")).toBeVisible();

    if (isMobile(page)) {
      const list = page.getByTestId("schedule-day-list");
      await list.getByRole("tab").nth(2).click();
      await expect(list.getByTestId("shift-warnings").first()).toContainText("Below the minimum age");
      await expect(list).toContainText("King St"); // location label per row with All locations
    } else {
      const grid = page.getByTestId("schedule-grid");
      await expect(grid.getByRole("row", { name: /Liam Host/ }).getByTestId("shift-warnings")).toContainText("Below the minimum age");
    }

    // Scheduled wages are labelled as such — never "labour cost".
    await expect(page.getByTestId("scheduled-wages")).toContainText("Scheduled wages");
    await expect(page.getByText(/labour cost/i)).toHaveCount(0);

    await page.getByRole("button", { name: /^Publish \d+ shift/ }).click();
    const pub = page.getByRole("dialog");
    await expect(pub.getByTestId("publish-warnings")).toContainText("Liam Host");
    await expect(pub.getByTestId("publish-warnings")).toContainText("Below the minimum age");
    await pub.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText("Schedule published.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Published" })).toBeDisabled();

    // Still warned after publishing: the warning persists until resolved (§5.1).
    await page.goto(base);
    await expect(page.getByTestId("dashboard-schedule-warnings")).toContainText("Liam Host");
  });

  test("the schedule shows statutory holidays before you build", async ({ page }) => {
    const base = await signInToBusiness(page, "manager@maple.example.com");
    await openSchedule(page, base, "?week=2026-10-12");
    if (isMobile(page)) {
      await expect(page.getByTestId("schedule-day-list").getByTestId("holiday")).toContainText("Thanksgiving");
    } else {
      await expect(page.getByTestId("schedule-grid").getByTestId("holiday")).toContainText("Thanksgiving");
    }
  });

  test("a manager with one location sees no switcher; the owner can switch to All locations", async ({ page }) => {
    let base = await signInToBusiness(page, "manager@maple.example.com");
    await openSchedule(page, base);
    await expect(page.getByLabel("Location", { exact: true })).toHaveCount(0);

    await page.context().clearCookies();
    base = await signInToBusiness(page, "owner@maple.example.com");
    await openSchedule(page, base, "?loc=");
    const sw = page.getByRole("combobox", { name: "Location" });
    await expect(sw).toBeVisible();
    await sw.selectOption({ label: "Queen St" });
    await expect(page).toHaveURL(/loc=/);
    await expect(sw).toHaveValue(/.+/);
    await expect(sw.locator("option:checked")).toHaveText("Queen St");
  });

  test("employees get My shifts, a read-only team schedule without wages, and a private calendar link", async ({ page, request }) => {
    const base = await signInToBusiness(page, "noah@maple.example.com");
    await page.goto(`${base}/schedule`);
    await expect(page.getByRole("heading", { name: "My shifts" })).toBeVisible();
    await expect(page.getByTestId("my-shifts").getByRole("listitem").first()).toContainText("Kitchen");
    await expectNoHorizontalScroll(page);

    await page.getByRole("button", { name: /Get calendar link|Create a new link/ }).click();
    const url = await page.getByTestId("feed-url").inputValue();
    expect(url).toMatch(/\/api\/calendar\/[\w-]+\.ics$/);
    const res = await request.get(new URL(url).pathname);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("Kitchen shift — Maple Bistro");

    await page.getByRole("link", { name: "Team schedule" }).click();
    await expect(page.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
    await expect(page.getByTestId("scheduled-wages")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add shift", exact: true })).toHaveCount(0);
    await expect(page.getByText("Draft", { exact: true })).toHaveCount(0);
  });

  test("copy last week creates drafts", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop only: mutates shared seed data");
    const base = await signInToBusiness(page, "manager@maple.example.com");
    const week = addDays(mondayOf(new Date()), 7 * 5);
    await openSchedule(page, base, `?week=${addDays(week, -7)}`);
    // Put one shift in the source week.
    await page.getByRole("button", { name: "Add shift", exact: true }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Date").fill(addDays(week, -6));
    await d.getByLabel("Employee").selectOption({ label: "Emma Server" });
    await d.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Shift created.")).toBeVisible();
    await openSchedule(page, base, `?week=${week}`);
    await page.getByRole("button", { name: "Copy last week" }).click();
    await expect(page.getByText("Copied last week.")).toBeVisible();
    await expect(page.getByTestId("schedule-grid").getByRole("row", { name: /Emma Server/ })).toContainText("09:00–17:00");
  });
});
