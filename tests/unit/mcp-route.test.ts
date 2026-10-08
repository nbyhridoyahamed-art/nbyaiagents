import { describe, expect, it } from "vitest";
import { GET, OPTIONS } from "@/app/api/mcp/route";

describe("MCP route: browser access (CORS)", () => {
  it("answers the preflight with the headers MCP clients send", () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    for (const header of ["authorization", "content-type", "mcp-protocol-version"]) expect(allowed).toContain(header);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("refuses GET (no server-to-client stream) but still sends CORS headers so browsers can read the 405", () => {
    const res = GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toContain("POST");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
