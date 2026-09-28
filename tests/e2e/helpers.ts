import { expect, type Page } from "@playwright/test";

export const PASSWORD = "password1234";

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

/** Signs in a single-business user and returns their business base path, e.g. "/b/abc". */
export async function signInToBusiness(page: Page, email: string, password = PASSWORD, business = /Maple Bistro/) {
  await signIn(page, email, password);
  // Users who belong to several businesses land on a chooser first.
  await expect(page.getByRole("heading", { name: "Choose a business" }).or(page.getByRole("heading", { name: /^Welcome,/ }))).toBeVisible();
  if (await page.getByRole("heading", { name: "Choose a business" }).isVisible()) {
    await page.getByRole("link", { name: business }).click();
  }
  await expect(page).toHaveURL(/\/b\/[^/]+$/);
  return new URL(page.url()).pathname;
}

export function isMobile(page: Page) {
  return (page.viewportSize()?.width ?? 1000) < 768;
}

/** Spec §11: no horizontal scroll. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

export async function latestEmailText(page: Page, to: string) {
  await page.goto("/dev/emails");
  await page.getByTestId("dev-email-list").getByRole("link").filter({ hasText: to }).first().click();
  await page.getByText("Plain text").click();
  return (await page.getByTestId("dev-email-text").textContent()) ?? "";
}

/** Opens the newest dev email to `to` and returns [plain text, detail URL]. */
export async function openLatestEmail(page: Page, to: string) {
  await page.goto("/dev/emails");
  await page.getByTestId("dev-email-list").getByRole("link").filter({ hasText: to }).first().click();
  await page.getByText("Plain text").click();
  const text = (await page.getByTestId("dev-email-text").textContent()) ?? "";
  return { text, url: page.url() };
}

export function inviteLink(text: string) {
  const m = text.match(/\/invite\/[A-Za-z0-9_-]{20,}/);
  if (!m) throw new Error(`No invitation link in email:\n${text}`);
  return m[0];
}

export async function fillProfile(page: Page, pin = "2468") {
  await page.getByLabel("Mobile phone (with country code)").fill("+1 416 555 0142");
  await page.getByLabel("Date of birth").fill("1995-04-03");
  await page.getByLabel("Home address").fill("42 Test Ave, Toronto");
  await page.getByLabel("Name", { exact: true }).fill("Jo Contact");
  await page.getByLabel("Relationship").fill("Partner");
  await page.getByLabel("Phone", { exact: true }).fill("+1 416 555 0143");
  await page.getByLabel("PIN", { exact: true }).fill(pin);
  await page.getByLabel("Repeat PIN").fill(pin);
  await page.getByRole("button", { name: "Save and continue" }).click();
}
