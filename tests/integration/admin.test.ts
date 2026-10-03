import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { authenticateApiKey, createApiKey } from "@/server/services/api-keys";
import { setCatalogItemEnabled, setOrganizationPlan, setOrganizationSuspended, setUserDisabled, setUserPlatformRole, getUsageReport } from "@/server/services/admin";
import { createSession, signIn, validateSessionToken } from "@/server/services/auth";
import { connectIntegration } from "@/server/services/integrations";
import { executeTool } from "@/server/tools/executor";
import { createAgentRun } from "@/server/runtime/agent-runtime";
import { installWorkflowTemplate, HIRE_NEW } from "@/server/services/templates";
import { createAgent } from "@/server/services/agents";
import { createFixtureAgent, createFixtureOrg, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
});

async function admin() {
  return prisma.user.create({ data: { email: `root-${Date.now()}@vdo.test`, name: "Root", platformRole: "SUPER_ADMIN" } });
}

describe("platform admin", () => {
  it("suspending a company blocks its API keys and new runs, and reactivating restores them", async () => {
    const root = await admin();
    const { org, user, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {});
    const { key } = await createApiKey({ ...actor, userId: user.id }, { name: "k", scopes: ["agents:read"] });

    await expect(setOrganizationSuspended(root.id, org.id, true)).rejects.toSatisfy(isAppError); // reason required
    await setOrganizationSuspended(root.id, org.id, true, "Abuse report");
    await expect(authenticateApiKey(`Bearer ${key}`)).rejects.toSatisfy(isAppError);
    await expect(createAgentRun(org.id, agent.id, { input: "x", mode: "LIVE" })).rejects.toThrow(/suspended/);

    await setOrganizationSuspended(root.id, org.id, false);
    await expect(authenticateApiKey(`Bearer ${key}`)).resolves.toMatchObject({ orgId: org.id });
    const audit = await prisma.auditLog.findMany({ where: { actorUserId: root.id, action: { startsWith: "admin.org" } } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["admin.org.suspend", "admin.org.reactivate"]));
  });

  it("disabling a user signs them out everywhere and blocks sign-in; admins can't lock themselves out", async () => {
    const root = await admin();
    const { user } = await createFixtureOrg();
    const { token } = await createSession(user.id);
    await setUserDisabled(root.id, user.id, true);
    expect(await validateSessionToken(token)).toBeNull();
    await expect(signIn({ email: user.email, password: "test-password-123" })).rejects.toThrow(/disabled/);
    await setUserDisabled(root.id, user.id, false);
    await expect(signIn({ email: user.email, password: "test-password-123" })).resolves.toMatchObject({ id: user.id });

    await expect(setUserDisabled(root.id, root.id, true)).rejects.toSatisfy(isAppError);
    await expect(setUserPlatformRole(root.id, root.id, "USER")).rejects.toSatisfy(isAppError);
  });

  it("a platform-disabled integration can't be connected and its tools are blocked", async () => {
    const root = await admin();
    const { org, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, { "mock_search.web_search": "ALLOW" });
    await setCatalogItemEnabled(root.id, "integrations", "mock_search", false);
    const out = await executeTool({ orgId: org.id, agentId: agent.id, runId: null, toolKey: "mock_search.web_search", input: { query: "acme" }, mode: "LIVE", idempotencyKey: "k1" });
    expect(out.status).toBe("DENIED");
    await expect(connectIntegration(actor, "mock_search")).rejects.toThrow(/turned off/);
    await setCatalogItemEnabled(root.id, "integrations", "mock_search", true);
    const ok = await executeTool({ orgId: org.id, agentId: agent.id, runId: null, toolKey: "mock_search.web_search", input: { query: "acme" }, mode: "LIVE", idempotencyKey: "k2" });
    expect(ok.status).toBe("EXECUTED");
  });

  it("a platform-disabled template can't be installed", async () => {
    const root = await admin();
    const { actor } = await createFixtureOrg();
    await setCatalogItemEnabled(root.id, "templates", "lead-generation", false);
    await expect(installWorkflowTemplate(actor, "lead-generation", { roles: { sales: HIRE_NEW } })).rejects.toThrow(/turned off/);
  });

  it("enforces the plan's employee limit and reports usage against entitlements", async () => {
    const root = await admin();
    const { org, actor } = await createFixtureOrg();
    const base = { jobTitle: "Helper", model: { provider: "OFFLINE" as const, model: "offline-demo", temperature: 0.3, maxOutputTokens: 1000 } };
    for (let i = 0; i < 10; i++) await createAgent(actor, { ...base, name: `Agent ${i}` });
    await expect(createAgent(actor, { ...base, name: "One too many" })).rejects.toThrow(/up to 10/);
    await setOrganizationPlan(root.id, org.id, "STARTER");
    await expect(createAgent(actor, { ...base, name: "Now fine" })).resolves.toBeTruthy();

    const [row] = (await getUsageReport()).filter((r) => r.id === org.id);
    expect(row.agents).toMatchObject({ used: 11, limit: 25 });
  });
});
