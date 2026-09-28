import { expect, type Page } from "@playwright/test";

export const PASSWORD = "password1234";

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
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
