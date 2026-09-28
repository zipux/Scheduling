import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, signInToBusiness } from "./helpers";

function addDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

test.describe("Phase 5 — requests", () => {
  test("time off: a blackout is refused at submission with its reason; a valid request is approved by a manager", async ({ page }, info) => {
    const offset = info.project.name === "mobile" ? 30 : 34;
    let base = await signInToBusiness(page, "emma@maple.example.com");
    await page.goto(`${base}/requests`);
    await expect(page.getByTestId("blackout-notice")).toContainText("Annual food festival");
    await page.getByLabel("From", { exact: true }).fill(addDays(61));
    await page.getByLabel("To", { exact: true }).fill(addDays(61));
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByTestId("timeoff-error")).toContainText("Annual food festival");

    await page.getByLabel("From", { exact: true }).fill(addDays(offset));
    await page.getByLabel("To", { exact: true }).fill(addDays(offset + 1));
    await page.getByLabel("Reason (optional)").fill(`Trip ${info.project.name}`);
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Request sent.")).toBeVisible();
    await expect(page.getByTestId("my-timeoff").getByRole("listitem").first()).toContainText("Pending");
    await expectNoHorizontalScroll(page);

    await page.context().clearCookies();
    base = await signInToBusiness(page, "manager@maple.example.com");
    await page.goto(base);
    await expect(page.getByTestId("dashboard-requests")).toContainText("to review");
    await page.goto(`${base}/requests?tab=approvals`);
    const card = page.getByTestId("review-timeoff").filter({ hasText: `Trip ${info.project.name}` });
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Approved.")).toBeVisible();
    await expect(card).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("an employee picks up an open shift; a manager approves the handover", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "consumes the single seeded open shift");
    let base = await signInToBusiness(page, "emma@maple.example.com");
    await page.goto(`${base}/requests?tab=available`);
    const row = page.getByTestId("available-shifts").getByRole("listitem").filter({ hasText: "Open shift" }).first();
    await expect(row).toContainText("Server");
    await row.getByTestId("claim").click();
    await expect(row).toContainText("Claim pending");

    await page.context().clearCookies();
    base = await signInToBusiness(page, "manager@maple.example.com");
    await page.goto(`${base}/requests?tab=approvals`);
    const trade = page.getByTestId("review-trade").filter({ hasText: "Emma Server" }).filter({ hasText: "Pickup" });
    await trade.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Approved.")).toBeVisible();
    await expect(trade).toHaveCount(0);
  });

  test("a cook sees only shifts they're eligible for, and can offer a swap to an eligible coworker", async ({ page }, info) => {
    const base = await signInToBusiness(page, "noah@maple.example.com");
    await page.goto(`${base}/requests?tab=available`);
    // Mia's dropped Bar shift is not offered to a cook.
    await expect(page.getByText("Offered by a coworker")).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    test.skip(info.project.name !== "mobile", "one swap proposal is enough");
    await page.goto(`${base}/schedule?view=mine`);
    await page.getByTestId("my-shifts").getByRole("button", { name: "Swap" }).first().click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByTestId("swap-candidates")).toBeVisible();
    await expect(dlg.getByTestId("swap-candidates")).not.toContainText("Mia Bartender");
    await dlg.getByRole("button", { name: "Propose" }).first().click();
    await expect(page.getByText("Swap proposed.")).toBeVisible();
    await page.goto(`${base}/requests`);
    await expect(page.getByTestId("my-trades")).toContainText("Swap");
  });

  test("a manager with blackout.manage adds a blackout date", async ({ page }, info) => {
    const base = await signInToBusiness(page, "manager@maple.example.com");
    await page.goto(`${base}/settings`);
    await page.getByRole("link", { name: /Blackout dates/ }).click();
    const reason = `Private event ${info.project.name}`;
    await page.getByLabel("From", { exact: true }).fill(addDays(90));
    await page.getByLabel("To", { exact: true }).fill(addDays(91));
    await page.getByLabel("Reason").fill(reason);
    await page.getByRole("button", { name: "Add blackout" }).click();
    await expect(page.getByTestId("blackout-list")).toContainText(reason);
    await expectNoHorizontalScroll(page);
  });
});
