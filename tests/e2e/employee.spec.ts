import { expect, test } from "@playwright/test";
import { signUpWithCompany } from "./helpers";

/** Employee lifecycle through the UI (spec Phase 20): run a task, chat, pause/resume, duplicate, delete. */
test("employee lifecycle", async ({ page }) => {
  test.setTimeout(240_000);
  await signUpWithCompany(page);
  await page.getByRole("button", { name: /get started/i }).click();
  await page.getByLabel(/company name/i).fill("Lifecycle Co");
  await page.getByRole("button", { name: /^continue/i }).click();
  await page.getByRole("button", { name: /create my ai company/i }).click();
  await expect(page).toHaveURL(/onboarding\/team/, { timeout: 30_000 });
  const team = page.getByRole("group", { name: /recommended employees/i });
  const first = team.getByRole("button").first();
  for (const card of await team.getByRole("button").all()) if ((await card.getAttribute("aria-pressed")) === "true") await card.click();
  await first.click();
  await page.getByRole("button", { name: /hire 1 ai employee$/i }).click();
  await expect(page).toHaveURL(/dashboard|agents/, { timeout: 30_000 });

  await page.goto("/agents");
  await page.locator('a[href^="/agents/agent_"]').first().click();
  await expect(page).toHaveURL(/\/agents\/agent_/);
  const agentUrl = page.url().split("?")[0];
  const agentName = (await page.getByRole("heading", { level: 1 }).first().textContent())?.trim() ?? "";

  // Run: give a (simulated, since the employee is a draft) task and watch it finish.
  await page.goto(`${agentUrl}?tab=tasks`);
  await page.getByRole("button", { name: /new task/i }).click();
  await page.getByLabel(/^task$/i).fill("Summarise what our company does");
  await page.getByRole("button", { name: /assign & start/i }).click();
  await expect(page).toHaveURL(/\/tasks\/task_/, { timeout: 30_000 });
  await expect(page.getByText(/^completed$/i).first()).toBeVisible({ timeout: 60_000 });

  // Chat: a reply arrives from the (offline) model.
  await page.goto(`${agentUrl}?tab=chat`);
  await page.getByRole("textbox", { name: /^message$/i }).fill("Hello! What can you help with?");
  await page.getByRole("button", { name: /^send$/i }).click();
  const chat = page.getByRole("region", { name: new RegExp(`chat with ${agentName}`, "i") });
  await expect(chat.getByText(/offline demo model|couldn't find|help/i).first()).toBeVisible({ timeout: 60_000 });

  // Pause and resume.
  await page.goto(agentUrl);
  await page.getByRole("button", { name: /^pause$/i }).click();
  await expect(page.getByText(/^paused$/i).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /^resume$/i }).click();
  await expect(page.getByRole("button", { name: /^pause$/i })).toBeVisible({ timeout: 20_000 });

  // Duplicate, then delete the copy.
  await page.getByRole("button", { name: /more actions/i }).click();
  await page.getByRole("menuitem", { name: /duplicate/i }).click();
  await expect(page).not.toHaveURL(agentUrl, { timeout: 30_000 });
  await expect(page.getByText(/duplicated as a draft/i).first()).toBeVisible();
  await page.getByRole("button", { name: /more actions/i }).click();
  await page.getByRole("menuitem", { name: /delete|remove|archive/i }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /delete|remove|archive/i }).click();
  await expect(page).toHaveURL(/\/agents$/, { timeout: 30_000 });
  await expect(page.getByText(/was removed/i).first()).toBeVisible();
});
