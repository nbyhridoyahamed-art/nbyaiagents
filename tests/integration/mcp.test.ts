import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerAllJobHandlers } from "@/server/jobs/handlers";
import { createApiKey } from "@/server/services/api-keys";
import { POST, GET } from "@/app/api/mcp/route";
import { createFixtureAgent, createFixtureOrg, resetDb } from "./helpers";

beforeAll(() => registerAllJobHandlers());
beforeEach(async () => {
  await resetDb();
});

const call = (body: unknown, key?: string) =>
  POST(new Request("http://localhost/api/mcp", { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) }));
const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, params });

describe("MCP endpoint", () => {
  it("requires a valid API key and has no GET stream", async () => {
    expect((await call(rpc(1, "ping"))).status).toBe(401);
    expect((await call(rpc(1, "ping"), "nby_bogus_key")).status).toBe(401);
    expect(GET().status).toBe(405);
  });

  it("initializes, lists only the tools the key's scopes allow, and runs them", async () => {
    const { user, actor } = await createFixtureOrg();
    await createFixtureAgent(actor, {});
    const { key } = await createApiKey({ ...actor, userId: user.id }, { name: "MCP", scopes: ["agents:read"] });

    const init = await (await call(rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }), key)).json();
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities.tools).toBeDefined();

    expect((await call({ jsonrpc: "2.0", method: "notifications/initialized" }, key)).status).toBe(202);

    const list = await (await call(rpc(2, "tools/list"), key)).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(["list_agents"]);

    const agents = await (await call(rpc(3, "tools/call", { name: "list_agents", arguments: {} }), key)).json();
    expect(agents.result.isError).toBe(false);
    expect(JSON.parse(agents.result.content[0].text)).toHaveLength(1);

    const denied = await (await call(rpc(4, "tools/call", { name: "run_agent", arguments: { agentId: "x", input: "hi" } }), key)).json();
    expect(denied.result.isError).toBe(true);

    const unknown = await (await call(rpc(5, "tools/call", { name: "nope" }), key)).json();
    expect(unknown.error.code).toBe(-32602);
  });
});
