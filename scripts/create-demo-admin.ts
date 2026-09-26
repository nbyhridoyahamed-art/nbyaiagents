/**
 * Creates (or resets) a local demo admin account:
 *   - platform admin (SUPER_ADMIN), email verified
 *   - Owner of "NBY Demo Company" (onboarding completed)
 *
 * Credentials come from DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD in .env.
 * If the password is missing, a random one is generated and written to .env.
 *
 *   npm run demo:admin
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/security/password";
import { createOrganization } from "@/server/services/organizations";

function upsertEnv(key: string, value: string) {
  const file = ".env";
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const line = `${key}="${value}"`;
  const next = new RegExp(`^${key}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${text.trimEnd()}\n${line}\n`;
  fs.writeFileSync(file, next);
}

/** Creates or resets the demo admin and returns their user and the demo company. */
export async function ensureDemoAdmin() {
  const email = (process.env.DEMO_ADMIN_EMAIL || "admin@nby.test").toLowerCase();
  let password = process.env.DEMO_ADMIN_PASSWORD || "";
  if (!password) {
    password = `Demo-${crypto.randomBytes(9).toString("base64url")}1`;
    upsertEnv("DEMO_ADMIN_EMAIL", email);
    upsertEnv("DEMO_ADMIN_PASSWORD", password);
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: "Demo Admin", passwordHash, emailVerifiedAt: new Date(), platformRole: "SUPER_ADMIN" },
    update: { passwordHash, platformRole: "SUPER_ADMIN", emailVerifiedAt: new Date(), deletedAt: null },
  });

  const membership = await prisma.organizationMember.findFirst({ where: { userId: user.id, organization: { name: "NBY Demo Company", deletedAt: null } } });
  let orgId = membership?.orgId;
  if (!orgId) {
    const org = await createOrganization(user.id, {
      name: "NBY Demo Company",
      timezone: "UTC",
      industry: "SaaS / Software",
      companySize: "2–10",
      website: "https://nby.test",
      description: "Demo workspace for exploring NBY AI Agents.",
      businessGoals: ["more_leads", "faster_support", "content", "research"],
    });
    orgId = org.id;
  }
  await prisma.organizationMember.update({ where: { orgId_userId: { orgId, userId: user.id } }, data: { role: "OWNER" } });
  await prisma.organization.update({ where: { id: orgId }, data: { onboardingCompletedAt: new Date() } });

  return { user, orgId, email };
}

async function main() {
  const { email } = await ensureDemoAdmin();
  console.log(`Demo admin ready (${email}). Credentials are in .env as DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD.`);
  await prisma.$disconnect();
}

// Run only when executed directly (the seed imports ensureDemoAdmin).
if (/create-demo-admin\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
