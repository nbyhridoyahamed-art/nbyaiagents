import { describe, expect, it } from "vitest";
import { handleMessage } from "@/lib/mcp/server";

const principal = { orgId: "o", apiKeyId: "k", scopes: ["agents:read" as const] };

describe("MCP protocol", () => {
  it("negotiates the protocol version and advertises tools", async () => {
    const r = await handleMessage(principal, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(r).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } } });
  });
  it("lists only tools the key may use and ignores notifications", async () => {
    const r = (await handleMessage(principal, { jsonrpc: "2.0", id: 2, method: "tools/list" })) as { result: { tools: { name: string }[] } };
    expect(r.result.tools.map((t) => t.name)).toEqual(["list_agents"]);
    expect(await handleMessage(principal, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });
  it("rejects bad requests, unknown methods and scope-less tool calls", async () => {
    expect(await handleMessage(principal, { nope: true })).toMatchObject({ error: { code: -32600 } });
    expect(await handleMessage(principal, { jsonrpc: "2.0", id: 3, method: "x" })).toMatchObject({ error: { code: -32601 } });
    const denied = await handleMessage(principal, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "run_workflow", arguments: { workflowId: "w" } } });
    expect(denied).toMatchObject({ result: { isError: true } });
  });
});
