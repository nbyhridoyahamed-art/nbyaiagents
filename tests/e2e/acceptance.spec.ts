import { expect, test, type Page } from "@playwright/test";
import { signUpWithCompany } from "./helpers";

/**
 * Spec §137 acceptance scenario, end to end through the UI:
 * signup → company → Sarah → knowledge → tools → grants → workflow → simulate →
 * publish → lead → approval → email sent → CRM updated → activity → dashboard → inspect.
 */

test.describe.configure({ mode: "serial" });

async function waitForText(page: Page, text: RegExp, timeoutMs = 60_000) {
  await expect(page.getByText(text).first()).toBeVisible({ timeout: timeoutMs });
}

test("Virtual Desks acceptance scenario", async ({ page }) => {
  test.setTimeout(420_000);

  // 1–2. Sign up and create the company.
  await signUpWithCompany(page);
  await page.getByRole("button", { name: /get started/i }).click();
  await page.getByLabel(/company name/i).fill("Acme Robotics");
  await page.getByRole("button", { name: /^continue/i }).click();
  await page.getByRole("group", { name: /business goals/i }).getByRole("button").filter({ hasText: /lead/i }).first().click();
  await page.getByRole("button", { name: /create my ai company/i }).click();

  // 3. Hire Sarah — Sales Manager (from the recommended team).
  await expect(page).toHaveURL(/onboarding\/team/, { timeout: 30_000 });
  // Select exactly Sarah (recommendations may be pre-selected).
  const team = page.getByRole("group", { name: /recommended employees/i });
  for (const card of await team.getByRole("button").all()) {
    const isSarah = /sarah/i.test((await card.textContent()) ?? "");
    const pressed = (await card.getAttribute("aria-pressed")) === "true";
    if (isSarah !== pressed) await card.click();
  }
  await page.getByRole("button", { name: /hire 1 ai employee$/i }).click();
  await expect(page).toHaveURL(/dashboard|agents/, { timeout: 30_000 });

  // 5. Connect Mock CRM, Mock Email (and Mock Search for company research).
  await page.goto("/integrations");
  for (const name of ["Mock CRM", "Mock Email", "Mock Search"]) {
    const row = page.locator("li").filter({ hasText: name }).first();
    await row.getByRole("button", { name: /^connect$/i }).click();
    await expect(row.getByText(/connected/i).first()).toBeVisible({ timeout: 20_000 });
  }

  // Find Sarah's workspace.
  await page.goto("/agents");
  await page.getByRole("link", { name: /sarah/i }).first().click();
  await expect(page).toHaveURL(/\/agents\/agent_/);
  const agentUrl = page.url().split("?")[0];

  // 6. Grants: CRM read/write, company research, email draft; email send = approval required.
  await page.goto(`${agentUrl}?tab=tools`);
  const grants: [string, "Allowed" | "Requires approval"][] = [
    ["Search CRM contacts", "Allowed"],
    ["Create CRM lead", "Allowed"],
    ["Update CRM contact", "Allowed"],
    ["Research company", "Allowed"],
    ["Draft email", "Allowed"],
    ["Send email", "Requires approval"],
  ];
  for (const [tool, effect] of grants) {
    const sw = page.getByRole("switch", { name: new RegExp(`^(grant|revoke) ${tool}$`, "i") });
    if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
    const select = page.getByRole("combobox", { name: new RegExp(`permission for ${tool}$`, "i") });
    await select.click();
    await page.getByRole("option", { name: effect }).click();
  }
  await page.getByRole("button", { name: /save permissions/i }).click();
  await waitForText(page, /permissions saved/i, 20_000);

  // 4. Upload Sales SOP, Product Catalog, Pricing — and let Sarah use them.
  await page.goto("/knowledge");
  await page.getByRole("button", { name: /new collection|create collection/i }).first().click();
  await page.getByLabel(/^name$/i).fill("Sales Playbook");
  await page.getByRole("dialog").getByRole("button", { name: /^create/i }).click();
  await expect(page).toHaveURL(/\/knowledge\/kb_/, { timeout: 20_000 });
  await page.getByLabel(/choose files to upload/i).setInputFiles([
    { name: "Sales SOP.txt", mimeType: "text/plain", buffer: Buffer.from("Sales SOP. Qualify leads with a score from 0 to 100. Qualified leads score 70 or more. Every outbound email must be approved by a manager.") },
    { name: "Product Catalog.txt", mimeType: "text/plain", buffer: Buffer.from("Product catalog. Virtual Desks Robot Arm: industrial arm for small factories. Virtual Desks Vision: camera kit for quality control.") },
    { name: "Pricing.txt", mimeType: "text/plain", buffer: Buffer.from("Pricing. Robot Arm costs $12,000. Vision kit costs $2,500. Volume discounts only with approval.") },
  ]);
  for (const doc of ["Sales SOP", "Product Catalog", "Pricing"]) await expect(page.getByText(new RegExp(doc)).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/indexed/i).first()).toBeVisible({ timeout: 60_000 });
  const access = page.locator("section[aria-labelledby=access-title]");
  await access.getByRole("checkbox", { name: /sarah/i }).check();
  await access.getByRole("button", { name: /save/i }).click();
  await waitForText(page, /access updated/i, 20_000);

  // Publish Sarah so she can work live.
  await page.goto(agentUrl);
  await page.getByRole("button", { name: /^publish$/i }).click();
  await page.getByRole("button", { name: /publish version/i }).click();
  await waitForText(page, /v\d+ is live/i, 30_000);

  // 7–8. Lead Outreach Workflow (research → score → CRM → draft → approval → send).
  await page.goto("/templates/workflows/lead-generation");
  await page.getByLabel(/workflow name/i).fill("Lead Outreach Workflow");
  await page.getByRole("button", { name: /install as draft/i }).click();
  await expect(page).toHaveURL(/\/workflows\/wf_/, { timeout: 30_000 });
  const workflowUrl = page.url().split("?")[0];

  // 9–10. Simulation succeeds.
  await page.getByRole("button", { name: /test \(simulate\)/i }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(JSON.stringify({ lead: { name: "Dana Ortiz", email: "dana@initech.example", company: "Initech" } }));
  await page.getByRole("button", { name: /run simulation/i }).click();
  await expect(page).toHaveURL(/\/workflows\/runs\/wfr_/, { timeout: 30_000 });
  await expect(page.getByText(/^completed$/i).first()).toBeVisible({ timeout: 90_000 });

  // 11. Publish.
  await page.goto(workflowUrl);
  await page.getByRole("button", { name: /^publish$/i }).click();
  await waitForText(page, /published v1/i, 30_000);

  // 12. A lead triggers the workflow.
  await page.getByRole("button", { name: /run now/i }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(JSON.stringify({ lead: { name: "Priya Shah", email: "priya@globex.example", company: "Globex" } }));
  await page.getByRole("dialog").getByRole("button", { name: /^run$/i }).click();
  await expect(page).toHaveURL(/\/workflows\/runs\/wfr_/, { timeout: 30_000 });
  const runUrl = page.url();

  // 13–15. Sarah works; the email approval appears in the inbox and is approved.
  let sawEmailApproval = false;
  for (let i = 0; i < 30; i++) {
    await page.goto(runUrl);
    if (await page.getByText(/^completed$/i).first().isVisible()) break;
    await page.goto("/approvals");
    const approve = page.getByRole("button", { name: /^approve$/i }).first();
    if (await approve.isVisible()) {
      if (await page.getByText(/send email/i).first().isVisible()) sawEmailApproval = true;
      await approve.click();
      await waitForText(page, /approved/i, 20_000);
    } else {
      await page.waitForTimeout(2000);
    }
  }
  expect(sawEmailApproval).toBe(true);

  // 16–17 & 20. The run completed; the email was sent and the CRM updated — inspect afterwards.
  await page.goto(runUrl);
  await expect(page.getByText(/^completed$/i).first()).toBeVisible({ timeout: 60_000 });
  const steps = page.locator("section", { has: page.getByRole("heading", { name: /^steps$/i }) });
  for (const step of ["Log in CRM", "Send email"]) {
    const row = steps.locator("li").filter({ hasText: new RegExp(step, "i") }).first();
    await expect(row.getByText(/succeeded/i)).toBeVisible();
  }

  // 18. Activity log records each action.
  await page.goto("/settings/audit?action=tool.execute");
  await expect(page.getByText(/mock_email\.send_email/).first()).toBeVisible();
  await expect(page.getByText(/mock_crm\.create_lead/).first()).toBeVisible();

  // 19. Dashboard reflects the execution.
  await page.goto("/dashboard");
  const perf = page.locator("section", { has: page.getByRole("heading", { name: /workflow performance/i }) });
  await expect(perf.getByText("Lead Outreach Workflow").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /recent company activity/i })).toBeVisible();
});
