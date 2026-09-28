import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, isMobile, signInToBusiness } from "./helpers";

// 1×1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test.describe("Phase 8 — messaging", () => {
  test("a manager messages an employee, who sees the unread badge and the message", async ({ page }, info) => {
    const text = `Can you swap Tuesday? (${info.project.name})`;
    let base = await signInToBusiness(page, "manager@maple.example.com");
    await page.goto(`${base}/messages`);
    await page.getByTestId("conversations").getByRole("link", { name: /Emma Server/ }).click();
    await expect(page.getByTestId("thread")).toContainText("Can you cover the patio on Friday?");
    await page.getByLabel("Message").fill(text);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("thread")).toContainText(text);
    await page.getByLabel("Attach an image").first().setInputFiles({ name: "menu.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByTestId("thread").getByRole("img", { name: /Image from Marco Manager/ }).last()).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.context().clearCookies();
    base = await signInToBusiness(page, "emma@maple.example.com");
    const nav = isMobile(page) ? page.getByTestId("bottom-tab-bar") : page.getByTestId("side-nav");
    await expect(nav.getByTestId("count-badge")).toBeVisible({ timeout: 20_000 });
    await nav.getByRole("link", { name: /Messages/ }).click();
    await page.getByTestId("conversations").getByRole("link", { name: /Marco Manager/ }).click();
    await expect(page.getByTestId("thread")).toContainText(text);
  });

  test("group chats show only to their members", async ({ page }) => {
    let base = await signInToBusiness(page, "noah@maple.example.com");
    await page.goto(`${base}/messages`);
    await expect(page.getByTestId("conversations")).toContainText("Kitchen crew");
    await page.context().clearCookies();
    base = await signInToBusiness(page, "liam@maple.example.com");
    await page.goto(`${base}/messages`);
    await expect(page.getByText("Kitchen crew")).toHaveCount(0);
  });

  test("an announcement asks for confirmation; the sender sees receipts; the bell lists it", async ({ page }, info) => {
    const title = `Menu tasting ${info.project.name}`;
    let base = await signInToBusiness(page, "owner@maple.example.com");
    await page.goto(`${base}/messages?tab=announcements`);
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Message", { exact: true }).fill("Wednesday at 4pm in the dining room.");
    await page.getByRole("switch", { name: /confirm they've read it/ }).click();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Announcement sent.")).toBeVisible();

    await page.context().clearCookies();
    base = await signInToBusiness(page, "clara@maple.example.com");
    await page.getByTestId("notification-bell").click();
    await expect(page.getByTestId("notification-list")).toContainText(title);
    await page.keyboard.press("Escape");
    await page.goto(`${base}/messages?tab=announcements`);
    const item = page.getByTestId("announcement").filter({ hasText: title });
    await item.getByRole("button", { name: "I've read this" }).click();
    await expect(item).toContainText("Confirmed");

    await page.context().clearCookies();
    base = await signInToBusiness(page, "owner@maple.example.com");
    await page.goto(`${base}/messages?tab=announcements`);
    const mine = page.getByTestId("announcement").filter({ hasText: title });
    await mine.getByRole("button", { name: "Read receipts" }).click();
    await expect(mine.getByTestId("receipts")).toContainText("Clara Clock: Confirmed");
    await expectNoHorizontalScroll(page);
  });

  test("email preferences can be turned off per type", async ({ page }) => {
    const base = await signInToBusiness(page, "noah@maple.example.com");
    await page.goto(`${base}/account`);
    const sw = page.getByTestId("notification-prefs").getByRole("switch", { name: "Announcements" });
    const before = await sw.getAttribute("aria-checked");
    const after = before === "true" ? "false" : "true";
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", after);
    await page.reload();
    await expect(page.getByTestId("notification-prefs").getByRole("switch", { name: "Announcements" })).toHaveAttribute("aria-checked", after);
  });
});
