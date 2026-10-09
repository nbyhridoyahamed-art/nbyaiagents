import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/security/crypto";
import { toolsForIntegration } from "@/lib/tools/registry";
import { connectGitHub, connectIntegration, finalizeOAuthConnection, listIntegrations } from "@/server/services/integrations";
import { createFixtureOrg, resetDb } from "./helpers";

const savedDemo = process.env.SHOW_DEMO_INTEGRATIONS;

beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (savedDemo === undefined) delete process.env.SHOW_DEMO_INTEGRATIONS;
  else process.env.SHOW_DEMO_INTEGRATIONS = savedDemo;
});

describe("demo integrations are hidden when switched off", () => {
  it("leaves the real integrations and hides the simulated ones", async () => {
    process.env.SHOW_DEMO_INTEGRATIONS = "false";
    const { org } = await createFixtureOrg();
    const keys = (await listIntegrations(org.id)).map((i) => i.key);
    expect(keys.some((k) => k.startsWith("mock_"))).toBe(false);
    expect(keys).toEqual(expect.arrayContaining(["gmail", "google_search_console", "google_analytics", "github", "web_search", "custom_http", "webhook"]));
  });

  it("refuses to connect a demo integration while hidden", async () => {
    process.env.SHOW_DEMO_INTEGRATIONS = "false";
    const { actor } = await createFixtureOrg();
    await expect(connectIntegration(actor, "mock_crm")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(await prisma.integrationConnection.count({ where: { orgId: actor.orgId } })).toBe(0);
  });

  it("keeps a demo integration visible in a workspace that already connected it", async () => {
    process.env.SHOW_DEMO_INTEGRATIONS = "true";
    const { org, actor } = await createFixtureOrg();
    await connectIntegration(actor, "mock_crm");
    process.env.SHOW_DEMO_INTEGRATIONS = "false";
    const keys = (await listIntegrations(org.id)).map((i) => i.key);
    expect(keys).toContain("mock_crm");
    expect(keys).not.toContain("mock_email");
  });
});

describe("Google grant now includes Search Console and Analytics", () => {
  it("connects all five Google integrations and their tools from one consent", async () => {
    const { actor } = await createFixtureOrg();
    const results = await finalizeOAuthConnection(actor, "google", { accessToken: "ya29.test", refreshToken: "1//refresh", expiresAt: Date.now() + 3_600_000, scope: "x" });
    expect(results.map((r) => r.key).sort()).toEqual(["gmail", "google_analytics", "google_calendar", "google_search_console", "google_sheets"]);

    const tools = await prisma.tool.findMany({ where: { orgId: actor.orgId, integrationKey: { in: ["google_search_console", "google_analytics"] } }, orderBy: { key: "asc" } });
    expect(tools.map((t) => t.key)).toEqual([
      "google_analytics.list_properties",
      "google_analytics.run_report",
      "google_search_console.inspect_url",
      "google_search_console.list_sites",
      "google_search_console.search_performance",
    ]);
    expect(tools.every((t) => t.enabled && !t.isSimulated && t.riskLevel === "LOW")).toBe(true);
    expect(toolsForIntegration("google_search_console")).toHaveLength(3);
    expect(toolsForIntegration("google_analytics")).toHaveLength(2);
  });
});

describe("connectGitHub", () => {
  const TOKEN = "github_pat_test_abcdefghijklmnopqrstuvwxyz";

  it("rejects a token GitHub doesn't accept and saves nothing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    const { actor } = await createFixtureOrg();
    await expect(connectGitHub(actor, { token: TOKEN })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await prisma.toolCredential.count({ where: { orgId: actor.orgId } })).toBe(0);
    expect(await prisma.integrationConnection.count({ where: { orgId: actor.orgId, integrationKey: "github" } })).toBe(0);
  });

  it("rejects input that can't be a token without calling GitHub", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { actor } = await createFixtureOrg();
    for (const token of ["", "short", "has spaces in the middle of it 1234567890"]) {
      await expect(connectGitHub(actor, { token })).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores the token encrypted, records who it belongs to and connects six tools", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ login: "octocat" }), { status: 200 }));
    const { actor } = await createFixtureOrg();

    const conn = await connectGitHub(actor, { token: `  ${TOKEN}  ` });

    expect(conn.status).toBe("CONNECTED");
    expect(conn.config).toEqual({ login: "octocat" });
    const cred = await prisma.toolCredential.findFirstOrThrow({ where: { orgId: actor.orgId } });
    expect(cred.ciphertext).not.toContain(TOKEN);
    expect(decryptSecret(cred.ciphertext)).toBe(TOKEN);

    const tools = await prisma.tool.findMany({ where: { orgId: actor.orgId, integrationKey: "github" }, orderBy: { key: "asc" } });
    expect(tools.map((t) => t.key)).toEqual(["github.comment_on_issue", "github.create_issue", "github.list_issues", "github.list_pull_requests", "github.list_repos", "github.read_file"]);
    expect(tools.filter((t) => t.riskLevel === "MEDIUM").map((t) => t.key)).toEqual(["github.comment_on_issue", "github.create_issue"]);

    const audit = await prisma.auditLog.findMany({ where: { orgId: actor.orgId } });
    expect(JSON.stringify(audit)).not.toContain(TOKEN);
  });
});
