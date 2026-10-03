import { describe, expect, it } from "vitest";
import { handleMcpMessage, MCP_PROTOCOL_VERSION } from "@/lib/mcp/server";
import type { ApiPrincipal } from "@/server/services/api-keys";

const readOnly: ApiPrincipal = { orgId: "org_1", apiKeyId: "key_1", scopes: ["agents:read", "tasks:read"] };

describe("MCP server", () => {
  it("negotiates the protocol version and advertises tools", async () => {
    const res = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }, readOnly)) as { result: { protocolVersion: string; capabilities: { tools: object } } };
    expect(res.result.protocolVersion).toBe("2024-11-05");
    expect(res.result.capabilities.tools).toBeDefined();
    const fallback = (await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, readOnly)) as { result: { protocolVersion: string } };
    expect(fallback.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  });

  it("only lists tools the API key's scopes allow", async () => {
    const res = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, readOnly)) as { result: { tools: { name: string; inputSchema: { type: string } }[] } };
    expect(res.result.tools.map((t) => t.name).sort()).toEqual(["get_task", "list_employees"]);
    expect(res.result.tools[0].inputSchema.type).toBe("object");
  });

  it("refuses tools outside the key's scopes", async () => {
    const res = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "assign_work", arguments: {} } }, readOnly)) as { error: { code: number } };
    expect(res.error.code).toBe(-32602);
  });

  it("reports invalid arguments as a tool error, not a protocol error", async () => {
    const res = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_task", arguments: {} } }, readOnly)) as { result: { isError: boolean } };
    expect(res.result.isError).toBe(true);
  });

  it("answers ping, ignores notifications and rejects unknown methods", async () => {
    expect(await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "ping" }, readOnly)).toMatchObject({ result: {} });
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, readOnly)).toBeNull();
    expect(await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "nope" }, readOnly)).toMatchObject({ error: { code: -32601 } });
    expect(await handleMcpMessage({ nope: true }, readOnly)).toMatchObject({ error: { code: -32600 } });
  });
});
