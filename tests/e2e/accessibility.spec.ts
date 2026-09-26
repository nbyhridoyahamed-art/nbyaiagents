import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signUpWithCompany } from "./helpers";

/** Automated accessibility audit (spec §107): no serious or critical WCAG 2 A/AA violations. */

const PAGES = ["/dashboard", "/office", "/agents", "/tasks", "/approvals", "/inbox", "/workflows", "/workflows/new?mode=describe", "/knowledge", "/integrations", "/analytics", "/templates", "/settings", "/settings/api-keys", "/help"];

test("key pages have no serious accessibility violations", async ({ page }) => {
  test.setTimeout(300_000);
  await signUpWithCompany(page);
  await page.getByRole("button", { name: /get started/i }).click();
  await page.getByLabel(/company name/i).fill("A11y Co");
  await page.getByRole("button", { name: /^continue/i }).click();
  await page.getByRole("button", { name: /create my ai company/i }).click();
  await expect(page).toHaveURL(/onboarding\/team/, { timeout: 30_000 });
  // Hire the recommended team so pages have real content to audit.
  await page.getByRole("button", { name: /hire \d+ ai employee/i }).click();
  await expect(page).toHaveURL(/dashboard|agents/, { timeout: 30_000 });

  const failures: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400); // entrance animations
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    for (const v of results.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) {
      failures.push(`${path} — ${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n    ")}`);
    }
  }
  expect(failures, failures.join("\n")).toEqual([]);
});
