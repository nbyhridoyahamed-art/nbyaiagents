import { beforeEach, describe, expect, it } from "vitest";
import { createApiKey } from "@/server/services/api-keys";
import { POST as mcp, GET as mcpGet } from "@/app/api/mcp/route";
import { createFixtureAgent, createFixtureOrg, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
});

const call = (body: unknown, key?: string) =>
  mcp(new Request("http://localhost/api/mcp", { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) }));

describe("MCP endpoint", () => {
  it("requires an API key", async () => {
    const res = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    // Browser-based clients can only read the 401 (and tell the user the key is wrong) if CORS headers are present.
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect((await mcpGet()).status).toBe(405);
  });

  it("lists employees through a tool call, scoped to the key's organization", async () => {
    const { user, actor } = await createFixtureOrg();
    await createFixtureAgent(actor, {});
    const { key } = await createApiKey({ ...actor, userId: user.id }, { name: "Claude", scopes: ["agents:read"] });

    const list = await (await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, key)).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(["list_employees"]);

    const res = await (await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_employees", arguments: {} } }, key)).json();
    expect(res.result.isError).toBeUndefined();
    expect(res.result.structuredContent.items).toHaveLength(1);

    const note = await call({ jsonrpc: "2.0", method: "notifications/initialized" }, key);
    expect(note.status).toBe(202);
  });
});
