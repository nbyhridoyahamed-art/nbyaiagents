import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { connectGitHub, finalizeOAuthConnection } from "@/server/services/integrations";
import { testTool } from "@/server/services/tools";
import { createFixtureOrg, resetDb, toolId } from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterEach(() => vi.restoreAllMocks());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const authorization = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>).authorization;

describe("Test tool (admin panel) uses the integration's saved credential", () => {
  it("runs a GitHub tool with the connected token", async () => {
    const TOKEN = "github_pat_tester_abcdefghijklmnopqrstuvwxyz";
    const { actor } = await createFixtureOrg();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ login: "octocat" }));
    await connectGitHub(actor, { token: TOKEN });

    fetchMock.mockResolvedValueOnce(json([{ full_name: "octocat/hello", private: false, description: null, default_branch: "main", updated_at: "x", open_issues_count: 0, html_url: "https://github.com/octocat/hello" }]));
    const res = await testTool(actor, await toolId(actor.orgId, "github.list_repos"), {}, "LIVE");

    expect(res.summary).toBe("1 repository");
    expect(authorization(fetchMock.mock.calls.at(-1)!)).toBe(`Bearer ${TOKEN}`);
    const tool = await prisma.tool.findFirstOrThrow({ where: { orgId: actor.orgId, key: "github.list_repos" } });
    expect(tool.lastTestOk).toBe(true);
  });

  it("runs a Google tool with the connected OAuth access token", async () => {
    const { actor } = await createFixtureOrg();
    await finalizeOAuthConnection(actor, "google", { accessToken: "ya29.tester-token", refreshToken: "1//refresh", expiresAt: Date.now() + 3_600_000, scope: "x" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] }));

    const res = await testTool(actor, await toolId(actor.orgId, "google_search_console.list_sites"), {}, "LIVE");

    expect(res.summary).toBe("1 Search Console site");
    expect(authorization(fetchMock.mock.calls.at(-1)!)).toBe("Bearer ya29.tester-token");
  });

  it("says the credential was revoked instead of claiming the integration isn't connected", async () => {
    const { actor } = await createFixtureOrg();
    await finalizeOAuthConnection(actor, "google", { accessToken: "ya29.tester-token", refreshToken: "1//refresh", expiresAt: Date.now() + 3_600_000, scope: "x" });
    await prisma.toolCredential.updateMany({ where: { orgId: actor.orgId }, data: { revokedAt: new Date() } });
    vi.spyOn(globalThis, "fetch");

    await expect(testTool(actor, await toolId(actor.orgId, "google_analytics.list_properties"), {}, "LIVE")).rejects.toThrow(/revoked or removed/);
    const tool = await prisma.tool.findFirstOrThrow({ where: { orgId: actor.orgId, key: "google_analytics.list_properties" } });
    expect(tool.lastTestOk).toBe(false);
  });
});
