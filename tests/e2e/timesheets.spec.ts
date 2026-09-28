import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, signInToBusiness } from "./helpers";

test.describe("Phase 7b — pay rules, timesheets, reports", () => {
  test("Pay rules states the owner's responsibility at the top and saves the holiday formula", async ({ page }) => {
    const base = await signInToBusiness(page, "owner@maple.example.com");
    await page.goto(`${base}/settings`);
    await page.getByRole("link", { name: /Pay rules/ }).click();
    await expect(page.getByTestId("payrules-responsibility")).toContainText("does not claim compliance");
    await expect(page.getByLabel("Average day's pay")).toHaveValue("fixed");
    await expect(page.getByLabel("Divide by")).toHaveValue("20");
    await page.getByLabel("Lookback window (days)").fill("28");
    await page.getByRole("form").or(page.locator("form")).last().getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.").first()).toBeVisible();
    await expect(page.getByTestId("break-rules")).toContainText("After 5 h in a row, a 30-minute break");
    await expectNoHorizontalScroll(page);
  });

  test("a manager sees the period's timesheets, opens one and exports payroll CSV", async ({ page, request }) => {
    const base = await signInToBusiness(page, "manager@maple.example.com");
    await page.goto(`${base}/timesheets`);
    const list = page.getByTestId("timesheet-list");
    await expect(list.getByRole("link").first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await list.getByRole("link", { name: /Emma Server/ }).click();
    await expect(page.getByTestId("timesheet-summary")).toContainText("Estimated gross pay");
    await expectNoHorizontalScroll(page);

    await page.goto(`${base}/timesheets`);
    const href = await page.getByTestId("export-csv").getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const csv = await res.text();
    expect(csv.split("\r\n")[0]).toContain("Regular hours");
    expect(csv).toContain("Vacation balance");
    void request;
  });

  test("reports render and export", async ({ page }) => {
    const base = await signInToBusiness(page, "manager@maple.example.com");
    await page.goto(`${base}/reports?type=attendance`);
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
    const href = await page.getByTestId("report-export").getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect((await res.text()).split("\r\n")[0]).toBe("Work-day,Employee,Location,Event,Time,Status");
    await expectNoHorizontalScroll(page);
  });

  test("an employee sees their own timesheet but not everyone's, nor reports or pay rules", async ({ page }) => {
    const base = await signInToBusiness(page, "noah@maple.example.com");
    await page.getByTestId("dashboard-clock").isVisible();
    await page.getByRole("link", { name: "My timesheet" }).click();
    await expect(page.getByTestId("timesheet-summary")).toBeVisible();
    await expect(page.getByTestId("approve-panel")).toHaveCount(0);
    for (const path of ["/timesheets", "/reports", "/settings/pay-rules"]) {
      const res = await page.goto(`${base}${path}`);
      expect(res?.status(), path).toBe(404);
    }
  });

  test("a manager without payrules.manage can't open Pay rules", async ({ page }) => {
    const base = await signInToBusiness(page, "manager@maple.example.com");
    const res = await page.goto(`${base}/settings/pay-rules`);
    expect(res?.status()).toBe(404);
  });
});

test("an Owner approves a finished period's timesheet from the UI", async ({ page }, info) => {
  const who = info.project.name === "mobile" ? "Pat Kiosk" : "Omar Offline";
  const base = await signInToBusiness(page, "owner@maple.example.com");
  await page.goto(`${base}/timesheets`);
  // Go to the previous (finished) period.
  await page.getByRole("link", { name: "Previous period" }).click();
  await expect(page).toHaveURL(/period=/);
  await page.getByTestId("timesheet-list").getByRole("link", { name: new RegExp(who) }).click();
  const panel = page.getByTestId("approve-panel");
  if (await panel.getByRole("checkbox").count()) await panel.getByRole("checkbox").click();
  await panel.getByRole("button", { name: "Approve timesheet" }).click();
  await expect(page.getByText("Timesheet approved.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reopen (Owner)" })).toBeVisible();
});
