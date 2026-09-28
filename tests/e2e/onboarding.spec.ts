import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, fillProfile, inviteLink, openLatestEmail, signIn, signInToBusiness } from "./helpers";

test.describe("Phase 2 — onboarding", () => {
  test("platform admin creates a business; the owner accepts, completes profile and the setup wizard", async ({ page }, info) => {
    const tag = `${info.project.name}-${Date.now().toString(36)}`;
    const ownerEmail = `owner-${tag}@example.com`;
    const bizName = `Test Diner ${tag}`;

    await signIn(page, "admin@example.com");
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole("link", { name: "Create business" }).click();
    await page.getByLabel("Business name").fill(bizName);
    await page.getByLabel("Province / state").selectOption("BC");
    await page.getByLabel("Default timezone").selectOption("America/Vancouver");
    await page.getByLabel("Owner's name").fill("Tess Owner");
    await page.getByLabel("Owner's email").fill(ownerEmail);
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: "Create and invite owner" }).click();
    await expect(page.getByRole("heading", { name: bizName })).toBeVisible();
    await expect(page.getByTestId("owner-invitation")).toContainText("Invited");
    await page.context().clearCookies();

    const { text } = await openLatestEmail(page, ownerEmail);
    await page.goto(inviteLink(text));
    await expect(page.getByRole("heading", { name: `Join ${bizName}` })).toBeVisible();
    await page.getByLabel("Choose a password").fill("owner-password-1");
    await page.getByLabel("Confirm password").fill("owner-password-1");
    await page.getByRole("button", { name: "Create account and join" }).click();

    await expect(page.getByRole("heading", { name: "Complete your profile" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await fillProfile(page);

    await expect(page.getByRole("heading", { name: "Set up your business" })).toBeVisible();
    await page.getByLabel("Location name").fill("Main Floor");
    await page.getByLabel("Latitude").fill("49.2827");
    await page.getByLabel("Longitude").fill("-123.1207");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByLabel("Pay period", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    // BC preset pre-filled; the owner must confirm responsibility.
    await expect(page.getByText("These values are your responsibility")).toBeVisible();
    await expect(page.getByLabel("Daily overtime after (hours)")).toHaveValue("8");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page.getByText("Something on the Pay rules step needs fixing.")).toBeVisible();
    await page.getByRole("button", { name: "Go there" }).click();
    await page.getByRole("checkbox", { name: /I've reviewed these values/ }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Finish setup" }).click();

    await expect(page.getByRole("heading", { name: /Welcome, Tess Owner/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("owner invites an employee; a bounce shows Delivery failed until the address is fixed", async ({ page }, info) => {
    const tag = `${info.project.name}-${Date.now().toString(36)}`;
    const badEmail = `typo-${tag}@example.com`;
    const goodEmail = `new-${tag}@example.com`;

    const base = await signInToBusiness(page, "owner@maple.example.com");
    await page.goto(`${base}/people/invite`);
    await page.getByLabel("Name").fill("Nina New");
    await page.getByLabel("Email").fill(badEmail);
    await page.getByLabel("Role").selectOption({ label: "Employee" });
    await page.getByRole("checkbox", { name: "King St" }).click();
    await page.getByRole("checkbox", { name: "Server" }).click();
    await page.getByLabel(/Hourly wage/).fill("18.25");
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/people$`));
    const row = page.getByTestId("invitation-row").filter({ hasText: badEmail });
    await expect(row).toContainText("Invited");

    // Resend reports a bounce.
    const { url } = await openLatestEmail(page, badEmail);
    await page.goto(url);
    await page.getByRole("button", { name: "Simulate bounced" }).click();
    await expect(page.getByTestId("dev-email-status")).toHaveText("bounced");

    await page.goto(base);
    await expect(page.getByTestId("invitation-warning")).toBeVisible();
    await page.goto(`${base}/people`);
    await expect(row).toContainText("Delivery failed");
    await row.getByRole("button", { name: "Edit address & resend" }).click();
    await row.getByLabel("Email").fill(goodEmail);
    await row.getByRole("button", { name: "Save & resend" }).click();
    const fixedRow = page.getByTestId("invitation-row").filter({ hasText: goodEmail });
    await expect(fixedRow).toContainText("Invited");

    // The employee accepts with a magic link instead of a password.
    await page.context().clearCookies();
    const { text } = await openLatestEmail(page, goodEmail);
    await page.goto(inviteLink(text));
    await page.getByRole("button", { name: /No password/ }).click();
    await expect(page.getByRole("status")).toContainText("sent a sign-in link");
    const signInMail = await openLatestEmail(page, goodEmail);
    const magic = signInMail.text.match(/https?:\/\/\S+magic-link\/verify\S+/)![0];
    await page.goto(magic);
    await expect(page.getByRole("heading", { name: "Complete your profile" })).toBeVisible();
    await fillProfile(page, "1357");
    await expect(page.getByRole("heading", { name: /Welcome, Nina New/ })).toBeVisible();
  });

  test("an existing user signs in to accept a second business", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one run is enough: consumes seed state");
    const base = await signInToBusiness(page, "owner@harbour.example.com");
    await page.goto(`${base}/people/invite`);
    await page.getByLabel("Name").fill("Emma Server");
    await page.getByLabel("Email").fill("emma@maple.example.com");
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/people$`));
    await page.context().clearCookies();

    const { text } = await openLatestEmail(page, "emma@maple.example.com");
    await page.goto(inviteLink(text));
    await page.getByRole("link", { name: "Sign in to accept" }).click();
    await expect(page.getByLabel("Email")).toHaveValue("emma@maple.example.com");
    await page.getByLabel("Password").fill("password1234");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page.getByRole("heading", { name: "Complete your profile" })).toBeVisible();
    await fillProfile(page, "8642");
    await expect(page.getByRole("link", { name: "Harbour Café" })).toBeVisible();
    await expect(page.getByLabel("Switch business")).toBeVisible();
  });

  test("owner manages roles and permissions", async ({ page }, info) => {
    const roleName = `Expo ${info.project.name}`;
    const base = await signInToBusiness(page, "owner@maple.example.com");
    await page.goto(`${base}/settings`);
    await page.getByRole("link", { name: /Roles & permissions/ }).click();
    await expect(page.getByTestId("role-list")).toContainText("Shift Lead / Supervisor");
    await page.getByRole("button", { name: "New role" }).click();
    await page.getByLabel("Role name").fill(roleName);
    await page.getByLabel("Rank").last().fill("5");
    await page.getByRole("checkbox", { name: /Approve drops, swaps and pickups/ }).last().click();
    await page.getByRole("button", { name: "Create role" }).click();
    await expect(page.getByTestId("role-list")).toContainText(roleName);
    await expectNoHorizontalScroll(page);
  });

  test("employees can't reach people management or settings", async ({ page }) => {
    const base = await signInToBusiness(page, "noah@maple.example.com");
    for (const path of ["/people", "/people/invite", "/settings/roles"]) {
      const res = await page.goto(`${base}${path}`);
      expect(res?.status(), path).toBe(404);
    }
  });

  test("an employee changes their PIN with their password", async ({ page }) => {
    const base = await signInToBusiness(page, "mia@maple.example.com");
    await page.goto(`${base}/account`);
    await page.getByLabel("Current password").fill("wrong-password");
    await page.getByLabel("New PIN", { exact: true }).fill("9999");
    await page.getByLabel("Repeat new PIN").fill("9999");
    await page.getByRole("button", { name: "Change PIN" }).click();
    await expect(page.getByText("Incorrect password")).toBeVisible();
    await page.getByLabel("Current password").fill("password1234");
    await page.getByRole("button", { name: "Change PIN" }).click();
    await expect(page.getByText("PIN changed.")).toBeVisible();
  });
});
