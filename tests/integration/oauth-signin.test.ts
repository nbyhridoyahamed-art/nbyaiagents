import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/security/crypto";
import { getValidAccessToken } from "@/lib/integrations/oauth/tokens";
import { NEVER_EXPIRES, type OAuthTokenBundle } from "@/lib/integrations/oauth/types";
import { finalizeOAuthConnection } from "@/server/services/integrations";
import { testTool } from "@/server/services/tools";
import { createFixtureOrg, resetDb, toolId } from "./helpers";

// The refresh calls need the platform's OAuth app credentials. They're read when the environment is first parsed.
vi.hoisted(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "g-client";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "g-secret";
  process.env.GITHUB_OAUTH_CLIENT_ID = "gh-client";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "gh-secret";
});

beforeEach(async () => {
  await resetDb();
});
afterEach(() => vi.restoreAllMocks());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const MINUTE = 60_000;

async function connectGoogle(bundle: Partial<OAuthTokenBundle> = {}) {
  const fx = await createFixtureOrg();
  await finalizeOAuthConnection(fx.actor, "google", { accessToken: "ya29.old", refreshToken: "1//refresh", expiresAt: Date.now() + 60 * MINUTE, scope: "x", ...bundle });
  const connection = await prisma.integrationConnection.findFirstOrThrow({ where: { orgId: fx.actor.orgId, integrationKey: "google_analytics" } });
  return { ...fx, credentialId: connection.credentialId!, status: () => prisma.integrationConnection.findUniqueOrThrow({ where: { id: connection.id } }) };
}

describe("getValidAccessToken", () => {
  it("hands back a token that's still good without calling the provider", async () => {
    const { credentialId } = await connectGoogle();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await getValidAccessToken(credentialId, "google")).toBe("ya29.old");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes a token that's about to expire and keeps the new one", async () => {
    const { credentialId } = await connectGoogle({ expiresAt: Date.now() + 2 * MINUTE });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ access_token: "ya29.new", expires_in: 3600 }));

    expect(await getValidAccessToken(credentialId, "google")).toBe("ya29.new");
    expect(new URLSearchParams(String((fetchMock.mock.calls[0][1] as RequestInit).body)).get("grant_type")).toBe("refresh_token");
    // Stored, so the next caller doesn't refresh again — and the original refresh token survives.
    expect(await getValidAccessToken(credentialId, "google")).toBe("ya29.new");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(decryptSecret((await prisma.toolCredential.findUniqueOrThrow({ where: { id: credentialId } })).ciphertext)) as OAuthTokenBundle;
    expect(stored.refreshToken).toBe("1//refresh");
  });

  it("flags the connection for reconnecting when the refresh token no longer works", async () => {
    const { credentialId, status } = await connectGoogle({ expiresAt: Date.now() + MINUTE });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ error: "invalid_grant" }, 400));
    await expect(getValidAccessToken(credentialId, "google")).rejects.toMatchObject({ code: "NOT_CONFIGURED", message: "The Google connection needs to be reconnected." });
    expect(await status()).toMatchObject({ status: "NEEDS_REAUTH", lastError: expect.stringMatching(/refresh failed \(HTTP 400\)/) });
  });

  it("flags an expired token that can't be refreshed, rather than trying to", async () => {
    const { credentialId, status } = await connectGoogle({ refreshToken: "", expiresAt: Date.now() - MINUTE });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(getValidAccessToken(credentialId, "google")).rejects.toMatchObject({ message: expect.stringMatching(/needs to be reconnected/) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await status()).status).toBe("NEEDS_REAUTH");
  });

  it("treats a failure GitHub reports as HTTP 200 as a failed refresh", async () => {
    const { credentialId, status } = await connectGoogle({ expiresAt: Date.now() + MINUTE });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ error: "bad_refresh_token" }));
    await expect(getValidAccessToken(credentialId, "github")).rejects.toMatchObject({ message: "The GitHub connection needs to be reconnected." });
    expect((await status()).status).toBe("NEEDS_REAUTH");
  });
});

describe("signing in with GitHub", () => {
  const bundle: OAuthTokenBundle = { accessToken: "gho_signedin_abcdefghijklmnop", refreshToken: "", expiresAt: NEVER_EXPIRES, scope: "repo,read:user" };

  it("connects GitHub as the person who signed in and gives the tools their token", async () => {
    const { actor } = await createFixtureOrg();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ login: "octocat" }));

    const results = await finalizeOAuthConnection(actor, "github", bundle);

    expect(results.map((r) => ({ key: r.key, toolCount: r.toolCount }))).toEqual([{ key: "github", toolCount: 6 }]);
    const connection = await prisma.integrationConnection.findFirstOrThrow({ where: { orgId: actor.orgId, integrationKey: "github" } });
    expect(connection).toMatchObject({ status: "CONNECTED", config: { login: "octocat" } });
    const credential = await prisma.toolCredential.findUniqueOrThrow({ where: { id: connection.credentialId! } });
    expect(credential).toMatchObject({ type: "OAUTH2", name: "GitHub — octocat" });
    expect(credential.ciphertext).not.toContain(bundle.accessToken);
    expect(((fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>).authorization).toBe(`Bearer ${bundle.accessToken}`);

    // The tools run with that token (and it never expires, so nothing is refreshed).
    fetchMock.mockImplementation(async () => json([{ full_name: "octocat/hello", private: false, description: null, default_branch: "main", updated_at: "x", open_issues_count: 0, html_url: "https://github.com/octocat/hello" }]));
    const res = await testTool(actor, await toolId(actor.orgId, "github.list_repos"), {}, "LIVE");
    expect(res.summary).toBe("1 repository");
    const last = fetchMock.mock.calls.at(-1)!;
    expect(String(last[0])).toContain("https://api.github.com/user/repos");
    expect(((last[1] as RequestInit).headers as Record<string, string>).authorization).toBe(`Bearer ${bundle.accessToken}`);
  });

  it("saves nothing when GitHub doesn't accept the token it just issued", async () => {
    const { actor } = await createFixtureOrg();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({}, 401));
    await expect(finalizeOAuthConnection(actor, "github", bundle)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await prisma.toolCredential.count({ where: { orgId: actor.orgId } })).toBe(0);
    expect(await prisma.integrationConnection.count({ where: { orgId: actor.orgId, integrationKey: "github" } })).toBe(0);
  });
});
