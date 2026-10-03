import { z } from "zod";
import { isAppError } from "@/lib/errors";
import type { ApiPrincipal, ApiScope } from "@/server/services/api-keys";
import {
  agentRunBody,
  getTaskForApi,
  getWorkflowRunForApi,
  listAgentsForApi,
  listWorkflowsForApi,
  runAgentForApi,
  runWorkflowForApi,
  workflowRunBody,
} from "@/server/services/public-api";

/**
 * Model Context Protocol server (Streamable HTTP, stateless, JSON responses).
 * Lets Claude, ChatGPT and any other MCP client use a company's Virtual Desks
 * through the same scoped API keys as the REST API.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_VERSIONS = [MCP_PROTOCOL_VERSION, "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "virtual-desks-online", title: "Virtual Desks Online", version: "1.0.0" };

type Json = Record<string, unknown>;

interface ToolDef<S extends z.ZodType> {
  name: string;
  title: string;
  description: string;
  scope: ApiScope;
  readOnly: boolean;
  input: S;
  run: (p: ApiPrincipal, args: z.infer<S>) => Promise<unknown>;
}

function tool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<z.ZodType> {
  return def as unknown as ToolDef<z.ZodType>;
}

export const TOOLS: ToolDef<z.ZodType>[] = [
  tool({
    name: "list_employees",
    title: "List AI employees",
    description: "List the company's AI employees with their id, job title, department, status and whether they are published.",
    scope: "agents:read",
    readOnly: true,
    input: z.object({}),
    run: (p) => listAgentsForApi(p.orgId),
  }),
  tool({
    name: "assign_work",
    title: "Give an AI employee work",
    description: "Give an AI employee a piece of work. Starts a task in the background and returns it; poll `get_task` for the result. Use mode \"simulation\" to rehearse without real side effects.",
    scope: "agents:run",
    readOnly: false,
    input: agentRunBody.extend({ employeeId: z.string().min(1).describe("Employee id from list_employees") }),
    run: (p, a) => {
      const { employeeId, ...body } = a as z.infer<typeof agentRunBody> & { employeeId: string };
      return runAgentForApi(p, employeeId, body);
    },
  }),
  tool({
    name: "get_task",
    title: "Get task status and result",
    description: "Read the status, progress, result and any pending approvals of a task started with `assign_work`.",
    scope: "tasks:read",
    readOnly: true,
    input: z.object({ taskId: z.string().min(1) }),
    run: (p, a) => getTaskForApi(p.orgId, (a as { taskId: string }).taskId),
  }),
  tool({
    name: "list_workflows",
    title: "List workflows",
    description: "List workflows, including whether each has a published version that can be run.",
    scope: "workflows:read",
    readOnly: true,
    input: z.object({}),
    run: (p) => listWorkflowsForApi(p.orgId),
  }),
  tool({
    name: "run_workflow",
    title: "Run a workflow",
    description: "Start the published version of a workflow with the given input. Returns a run; poll `get_workflow_run` for the outcome.",
    scope: "workflows:run",
    readOnly: false,
    input: workflowRunBody.extend({ workflowId: z.string().min(1).describe("Workflow id from list_workflows") }),
    run: (p, a) => {
      const { workflowId, ...body } = a as z.infer<typeof workflowRunBody> & { workflowId: string };
      return runWorkflowForApi(p, workflowId, body, null);
    },
  }),
  tool({
    name: "get_workflow_run",
    title: "Get workflow run status",
    description: "Read the status, progress and output of a workflow run.",
    scope: "workflows:read",
    readOnly: true,
    input: z.object({ runId: z.string().min(1) }),
    run: (p, a) => getWorkflowRunForApi(p.orgId, (a as { runId: string }).runId),
  }),
];

function visibleTools(p: ApiPrincipal) {
  return TOOLS.filter((t) => p.scopes.includes(t.scope));
}

function rpcResult(id: unknown, result: unknown): Json {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: unknown, code: number, message: string): Json {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

/** Handles one JSON-RPC message. Returns null for notifications (no response body). */
export async function handleMcpMessage(msg: unknown, p: ApiPrincipal): Promise<Json | null> {
  if (!msg || typeof msg !== "object" || (msg as Json).jsonrpc !== "2.0" || typeof (msg as Json).method !== "string") {
    return rpcError((msg as Json | null)?.id, -32600, "Invalid JSON-RPC request.");
  }
  const { id, method, params } = msg as { id?: unknown; method: string; params?: Json };
  const isNotification = id === undefined;

  switch (method) {
    case "initialize": {
      const asked = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
      return rpcResult(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: "Virtual Desks Online: list your AI employees and workflows, give employees work, run workflows and read their results.",
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: visibleTools(p).map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: z.toJSONSchema(t.input, { io: "input" }),
          annotations: { readOnlyHint: t.readOnly, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const name = typeof params?.name === "string" ? params.name : "";
      const def = visibleTools(p).find((t) => t.name === name);
      if (!def) return rpcError(id, -32602, `Unknown tool "${name}", or this API key lacks its permission.`);
      const parsed = def.input.safeParse(params?.arguments ?? {});
      if (!parsed.success) {
        return rpcResult(id, { isError: true, content: [{ type: "text", text: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}` }] });
      }
      try {
        const data = await def.run(p, parsed.data);
        return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: Array.isArray(data) ? { items: data } : (data as Json) });
      } catch (err) {
        if (isAppError(err)) return rpcResult(id, { isError: true, content: [{ type: "text", text: err.message }] });
        console.error("[mcp] tool error", err);
        return rpcResult(id, { isError: true, content: [{ type: "text", text: "Something went wrong. Please try again." }] });
      }
    }
    default:
      if (isNotification || method.startsWith("notifications/")) return null;
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}
