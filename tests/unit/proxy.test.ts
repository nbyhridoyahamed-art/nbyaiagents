import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

const get = (path: string, cookie?: string) => new NextRequest(`https://app.example.com${path}`, cookie ? { headers: { cookie } } : undefined);

describe("proxy auth gate", () => {
  it("sends signed-out visits to app pages to the login page", () => {
    const res = proxy(get("/settings/api-keys"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.example.com/login?next=%2Fsettings%2Fapi-keys");
  });

  it("lets signed-in visits through", () => {
    expect(proxy(get("/settings/api-keys", "vdo_session=abc")).headers.get("location")).toBeNull();
  });

  it("leaves public pages and the API alone", () => {
    for (const path of ["/", "/login", "/signup", "/forgot-password", "/api/mcp", "/api/v1/agents"]) {
      expect(proxy(get(path)).headers.get("location"), path).toBeNull();
    }
  });

  it("does not bounce OAuth/MCP discovery probes to the HTML login page", () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp", "/.well-known/oauth-authorization-server"]) {
      expect(proxy(get(path)).headers.get("location"), path).toBeNull();
    }
  });
});
