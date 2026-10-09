import { describe, expect, it, vi } from "vitest";

// `server-only` throws when loaded outside a Next.js server bundle; the routes under test import it indirectly.
vi.mock("server-only", () => ({}));

import { GET as authorize } from "@/app/api/integrations/[provider]/authorize/route";
import { GET as callback } from "@/app/api/integrations/[provider]/callback/route";
import { env } from "@/lib/env";
import { appUrl } from "@/lib/url";

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
