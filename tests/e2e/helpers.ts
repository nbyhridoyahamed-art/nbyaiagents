import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { E2E } from "./env";

export const PASSWORD = "E2e-Passw0rd!long";

export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.test`;
}

/** Waits for the newest email to `to` in the local file mailbox and returns its first link. */
export async function linkFromEmail(to: string, contains: string, timeoutMs = 15_000): Promise<string> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const files = fs.existsSync(E2E.mailDir) ? fs.readdirSync(E2E.mailDir).sort().reverse() : [];
    for (const f of files) {
      const msg = JSON.parse(fs.readFileSync(path.join(E2E.mailDir, f), "utf8")) as { to: string; text: string };
      if (msg.to !== to) continue;
      const link = msg.text.match(/https?:\/\/\S+/g)?.find((l) => l.includes(contains));
      if (link) return link.replace(/[).,]+$/, "");
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No email to ${to} with a link containing "${contains}"`);
}

/** Signs up a fresh user and completes company setup. */
export async function signUpWithCompany(page: Page, opts: { name?: string; company?: string } = {}) {
  const email = uniqueEmail("owner");
  await page.goto("/signup");
  await page.getByLabel(/full name|your name|^name/i).fill(opts.name ?? "E2E Owner");
  await page.getByLabel(/work email|email/i).fill(email);
  await page.getByLabel(/^password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /create account|sign up/i }).click();
  await expect(page).toHaveURL(/onboarding/, { timeout: 30_000 });
  return { email };
}
