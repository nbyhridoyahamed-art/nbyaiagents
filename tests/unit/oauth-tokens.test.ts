import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // Read once, when the environment is first parsed — so before any test runs. HubSpot is left unset on purpose.
  process.env.GOOGLE_OAUTH_CLIENT_ID = "g-client";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "g-secret";
  process.env.GITHUB_OAUTH_CLIENT_ID = "gh-client";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "gh-secret";
  process.env.HUBSPOT_OAUTH_CLIENT_ID = "";
  process.env.HUBSPOT_OAUTH_CLIENT_SECRET = "";
});
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { exchangeCodeForToken } from "@/lib/integrations/oauth/tokens";
import { NEVER_EXPIRES } from "@/lib/integrations/oauth/types";

afterEach(() => vi.restoreAllMocks());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const REDIRECT = "https://app.example.com/api/integrations/x/callback";

describe("exchangeCodeForToken", () => {
  it("sends the code and the app's credentials to the provider's token endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ access_token: "ya29.a", refresh_token: "1//r", expires_in: 3600, scope: "s" }));
    const before = Date.now();
    const bundle = await exchangeCodeForToken("google", "the-code", REDIRECT);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).accept).toBe("application/json");
    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toEqual({ grant_type: "authorization_code", code: "the-code", redirect_uri: REDIRECT, client_id: "g-client", client_secret: "g-secret" });
    expect(bundle).toMatchObject({ accessToken: "ya29.a", refreshToken: "1//r", scope: "s" });
    expect(bundle.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
  });

  it("insists on a refresh token from providers that issue them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ access_token: "ya29.a", expires_in: 3600 }));
    await expect(exchangeCodeForToken("google", "c", REDIRECT)).rejects.toMatchObject({ code: "INTEGRATION_ERROR", message: expect.stringMatching(/Google didn't return a refresh token/) });
  });

  it("reports a rejected code with the provider's reason", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ error: "invalid_grant", error_description: "Code was already redeemed." }, 400));
    await expect(exchangeCodeForToken("google", "c", REDIRECT)).rejects.toMatchObject({ message: expect.stringMatching(/Google rejected the authorization code \(HTTP 400\): Code was already redeemed\./) });
  });

  it("takes GitHub's single long-lived token: no refresh token, never expires", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ access_token: "gho_abc", token_type: "bearer", scope: "repo,read:user" }));
    const bundle = await exchangeCodeForToken("github", "c", REDIRECT);
    expect(bundle).toEqual({ accessToken: "gho_abc", refreshToken: "", expiresAt: NEVER_EXPIRES, scope: "repo,read:user" });
  });

  it("notices GitHub's failures, which arrive as HTTP 200 with an error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ error: "bad_verification_code", error_description: "The code passed is incorrect or expired." }));
    await expect(exchangeCodeForToken("github", "c", REDIRECT)).rejects.toMatchObject({
      code: "INTEGRATION_ERROR",
      message: expect.stringMatching(/GitHub rejected the authorization code \(HTTP 200\): The code passed is incorrect or expired\./),
    });
  });

  it("keeps GitHub's expiry and refresh token when the operator turned on expiring tokens", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ access_token: "ghu_x", refresh_token: "ghr_y", expires_in: 28_800, refresh_token_expires_in: 15_811_200 }));
    const bundle = await exchangeCodeForToken("github", "c", REDIRECT);
    expect(bundle.refreshToken).toBe("ghr_y");
    expect(bundle.expiresAt).toBeLessThan(NEVER_EXPIRES);
    expect(bundle.expiresAt).toBeGreaterThan(Date.now() + 28_000_000);
  });

  it("explains when the platform has no OAuth app for the provider, without calling it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(exchangeCodeForToken("hubspot", "c", REDIRECT)).rejects.toMatchObject({ code: "NOT_CONFIGURED", message: "HubSpot OAuth app credentials are not configured on this platform." });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
