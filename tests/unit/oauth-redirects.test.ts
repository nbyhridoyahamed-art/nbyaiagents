import { beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws when loaded outside a Next.js server bundle; the routes under test import it indirectly.
vi.mock("server-only", () => ({}));

// The popup tests drive the routes through a sign-in without a provider, a session or a database.
const exchange = vi.hoisted(() => vi.fn());
const finalize = vi.hoisted(() => vi.fn());
const orgContext = vi.hoisted(() => vi.fn());
vi.hoisted(() => {
  // Read once, when the environment is first parsed — so before any test runs.
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-google-client";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-google-secret";
  process.env.GITHUB_OAUTH_CLIENT_ID = "test-github-client";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "test-github-secret";
});
vi.mock("@/lib/integrations/oauth/tokens", () => ({ exchangeCodeForToken: exchange }));
vi.mock("@/server/services/integrations", () => ({ finalizeOAuthConnection: finalize }));
vi.mock("@/lib/auth/context", () => ({ requireOrgContext: orgContext }));

import { GET as authorize } from "@/app/api/integrations/[provider]/authorize/route";
import { GET as callback } from "@/app/api/integrations/[provider]/callback/route";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { decodeState, encodeState } from "@/lib/integrations/oauth/state";
import { appUrl } from "@/lib/url";

// Signed out unless a test says otherwise.
beforeEach(() => {
  orgContext.mockReset();
  orgContext.mockRejectedValue(new AppError("UNAUTHENTICATED", "Sign in to continue."));
});

const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) }) as never;
const publicOrigin = () => new URL(env().APP_URL).origin;
// Behind a reverse proxy (Railway) the request URL carries the server's internal address, not the public one.
const internal = "http://localhost:8080";

describe("OAuth redirects use the public app URL", () => {
  it("builds absolute URLs on APP_URL", () => {
    expect(appUrl("/integrations?connected=1").href).toBe(`${env().APP_URL}/integrations?connected=1`);
    expect(appUrl("login").href).toBe(`${env().APP_URL}/login`);
  });

  it("sends the browser back to the app after the provider redirects to the callback", async () => {
    const res = await callback(new Request(`${internal}/api/integrations/google/callback?error=access_denied`), ctx("google"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe(publicOrigin());
    expect(location.pathname).toBe("/integrations");
    expect(location.searchParams.get("error")).toMatch(/cancelled/);
  });

  it("reports an invalid or expired connection link on the integrations page, not on the internal host", async () => {
    const res = await callback(new Request(`${internal}/api/integrations/google/callback?code=abc&state=not-a-valid-state`), ctx("google"));
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe(publicOrigin());
    expect(location.searchParams.get("error")).toMatch(/expired or is invalid/);
  });

  it("also keeps the start of the flow on the public URL", async () => {
    const res = await authorize(new Request(`${internal}/api/integrations/google/authorize`), ctx("google"));
    expect(new URL(res.headers.get("location")!).origin).toBe(publicOrigin());
  });
});

/** Pulls the result a popup page broadcasts out of its HTML. */
function broadcastResult(html: string): { ok: boolean; message: string; provider: string } {
  const m = /var result = (\{.*?\});/.exec(html);
  expect(m).not.toBeNull();
  return JSON.parse(m![1]);
}

describe("sign-in popup", () => {
  beforeEach(() => {
    exchange.mockReset();
    finalize.mockReset();
  });
  const popupState = (provider: "google" | "github", popup = true) => encodeState({ orgId: "org_1", userId: "user_1", provider, ...(popup ? { popup } : {}) });

  it("answers a popup that can't start with its result page instead of redirecting", async () => {
    const res = await authorize(new Request(`${internal}/api/integrations/nope/authorize?popup=1`), ctx("nope"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(broadcastResult(await res.text())).toMatchObject({ ok: false, message: "Unknown integration provider.", provider: "nope" });
  });

  it("tells a popup whose session has ended to sign in again, rather than loading the login page inside it", async () => {
    const res = await authorize(new Request(`${internal}/api/integrations/google/authorize?popup=1`), ctx("google"));
    expect(res.status).toBe(200);
    expect(broadcastResult(await res.text())).toMatchObject({ ok: false, message: expect.stringMatching(/session has ended/) });
  });

  const signedIn = () => orgContext.mockResolvedValue({ org: { id: "org_1" }, user: { id: "user_1" } });

  it("starts a popup sign-in and remembers it in the signed state", async () => {
    signedIn();
    const res = await authorize(new Request(`${internal}/api/integrations/google/authorize?popup=1`), ctx("google"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("client_id")).toBe("test-google-client");
    expect(location.searchParams.get("redirect_uri")).toBe(`${env().APP_URL}/api/integrations/google/callback`);
    expect(location.searchParams.get("scope")).toContain("webmasters.readonly");
    expect(decodeState(location.searchParams.get("state")!)).toMatchObject({ orgId: "org_1", userId: "user_1", provider: "google", popup: true });
  });

  it("starts GitHub's sign-in with its own app and scopes, and no popup flag when not asked", async () => {
    signedIn();
    const res = await authorize(new Request(`${internal}/api/integrations/github/authorize`), ctx("github"));
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("test-github-client");
    expect(location.searchParams.get("scope")).toBe("repo read:user");
    expect(decodeState(location.searchParams.get("state")!).popup).toBeUndefined();
  });

  it("reports a successful sign-in to the opener", async () => {
    exchange.mockResolvedValue({ accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 1000, scope: "s" });
    finalize.mockResolvedValue([]);
    const res = await callback(new Request(`${internal}/api/integrations/google/callback?code=abc&state=${popupState("google")}`), ctx("google"));
    expect(res.status).toBe(200);
    expect(broadcastResult(await res.text())).toEqual({ ok: true, message: "Google connected.", provider: "google", at: expect.any(Number) });
    expect(exchange).toHaveBeenCalledWith("google", "abc", `${env().APP_URL}/api/integrations/google/callback`);
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org_1", userId: "user_1" }), "google", expect.anything());
  });

  it("reports a cancelled sign-in, because the provider still sends the state back", async () => {
    const res = await callback(new Request(`${internal}/api/integrations/github/callback?error=access_denied&state=${popupState("github")}`), ctx("github"));
    expect(res.status).toBe(200);
    expect(broadcastResult(await res.text())).toMatchObject({ ok: false, message: "GitHub sign-in was cancelled.", provider: "github" });
    expect(exchange).not.toHaveBeenCalled();
  });

  it("reports the provider's refusal to the opener", async () => {
    exchange.mockRejectedValue(new (await import("@/lib/errors")).AppError("INTEGRATION_ERROR", "GitHub rejected the authorization code (HTTP 200): The code passed is incorrect or expired."));
    const res = await callback(new Request(`${internal}/api/integrations/github/callback?code=bad&state=${popupState("github")}`), ctx("github"));
    expect(broadcastResult(await res.text())).toMatchObject({ ok: false, message: expect.stringMatching(/incorrect or expired/) });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("keeps redirecting when the sign-in did not start in a popup", async () => {
    exchange.mockResolvedValue({ accessToken: "t", refreshToken: "r", expiresAt: 1, scope: "s" });
    finalize.mockResolvedValue([]);
    const res = await callback(new Request(`${internal}/api/integrations/google/callback?code=abc&state=${popupState("google", false)}`), ctx("google"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).searchParams.get("connected")).toBe("1");
  });

  it("falls back to a redirect when the state can't be read, since there is nobody to message", async () => {
    const res = await callback(new Request(`${internal}/api/integrations/google/callback?code=abc&state=garbage`), ctx("google"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toMatch(/expired or is invalid/);
  });

  it("refuses a state minted for another provider", async () => {
    const res = await callback(new Request(`${internal}/api/integrations/google/callback?code=abc&state=${popupState("github")}`), ctx("google"));
    expect(broadcastResult(await res.text())).toMatchObject({ ok: false, message: expect.stringMatching(/doesn't match the provider/) });
    expect(exchange).not.toHaveBeenCalled();
  });
});
