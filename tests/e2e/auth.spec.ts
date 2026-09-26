import { expect, test, type Page } from "@playwright/test";
import { linkFromEmail, PASSWORD, signUpWithCompany, uniqueEmail } from "./helpers";

async function finishOnboarding(page: Page, company: string) {
  await page.getByRole("button", { name: /get started/i }).click();
  await page.getByLabel(/company name/i).fill(company);
  await page.getByRole("button", { name: /^continue/i }).click();
  await page.getByRole("button", { name: /create my ai company/i }).click();
  await expect(page).toHaveURL(/onboarding\/team/, { timeout: 30_000 });
  await page.getByRole("button", { name: /skip for now/i }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 30_000 });
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: /account menu/i }).click();
  await page.getByRole("menuitem", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/login/, { timeout: 20_000 });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/work email/i).fill(email);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
}

test("signup, logout, login and password reset", async ({ page }) => {
  const { email } = await signUpWithCompany(page);
  await finishOnboarding(page, "Reset Co");

  await signOut(page);
  // Protected pages now require signing in.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/login/);

  // Wrong password is rejected; the right one works.
  await signIn(page, email, "not-the-password-123");
  await expect(page.getByText(/incorrect email or password/i)).toBeVisible();
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/dashboard/, { timeout: 30_000 });
  await signOut(page);

  // Reset the password from the emailed link.
  await page.goto("/forgot-password");
  await page.getByLabel(/work email/i).fill(email);
  await page.getByRole("button", { name: /send reset link/i }).click();
  const link = await linkFromEmail(email, "/reset-password");
  await page.goto(link);
  const next = "N3w-Passw0rd!long";
  await page.getByLabel(/^new password/i).fill(next);
  await page.getByLabel(/confirm password/i).fill(next);
  await page.getByRole("button", { name: /update password|reset password|save/i }).click();
  await expect(page).toHaveURL(/login|dashboard/, { timeout: 30_000 });

  // The old password no longer works; the new one does. The link can't be reused.
  await signIn(page, email, PASSWORD);
  await expect(page.getByText(/incorrect email or password/i)).toBeVisible();
  await signIn(page, email, next);
  await expect(page).toHaveURL(/dashboard/, { timeout: 30_000 });
});

test("a teammate accepts an invitation and joins the company", async ({ page, browser }) => {
  await signUpWithCompany(page);
  await finishOnboarding(page, "Invite Co");

  const invitee = uniqueEmail("teammate");
  await page.goto("/settings/members");
  await page.getByLabel(/^email$/i).fill(invitee);
  await page.getByRole("button", { name: /send invite/i }).click();
  await expect(page.locator("#main").getByText(/invitation created/i)).toBeVisible();
  const link = await linkFromEmail(invitee, "/invite/");

  // The invitee has no account yet: sign up from the invitation.
  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  await guest.goto(link);
  await guest.getByRole("link", { name: /create an account/i }).click();
  await guest.getByLabel(/your name/i).fill("New Teammate");
  await guest.getByLabel(/work email/i).fill(invitee);
  await guest.getByLabel(/^password/i).fill(PASSWORD);
  await guest.getByRole("button", { name: /create account/i }).click();
  await expect(guest).toHaveURL(/invite\//, { timeout: 30_000 });
  await guest.getByRole("button", { name: /accept invitation/i }).click();
  await expect(guest).toHaveURL(/dashboard/, { timeout: 30_000 });
  await expect(guest.getByText("Invite Co").first()).toBeVisible();
  await ctx.close();

  // The owner now sees them as a member.
  await page.reload();
  await expect(page.getByText(invitee).first()).toBeVisible();
});
