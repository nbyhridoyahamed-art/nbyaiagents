import { z } from "zod";
import { isAppError } from "@/lib/errors";
import { requireScope, type ApiPrincipal, type ApiScope } from "@/server/services/api-keys";
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
 * Model Context Protocol server (stateless Streamable HTTP, JSON responses). It exposes the
 * same operations as the public REST API v1, behind the same scoped API keys, so any MCP
 * client (Claude Code, Claude Desktop, Cursor, …) can drive the workspace.
 */

export const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const SERVER_INFO = { name: "virtual-desks-online", title: "Virtual Desks Online", version: "1.0.0" };

interface ToolDef {
  name: string;
  description: string;
  scope: ApiScope;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  run: (p: ApiPrincipal, args: unknown) => Promise<unknown>;
}

const idArg = (key: string) => z.object({ [key]: z.string().trim().min(1) });

const TOOLS: ToolDef[] = [
  {
    name: "list_agents",
    description: "List the company's AI employees (id, name, job title, department, status, whether published).",
    scope: "agents:read",
    readOnly: true,
    inputSchema: { type: "object", properties: {} },
    run: (p) => listAgentsForApi(p.orgId),
  },
  {
    name: "run_agent",
    description: "Give an AI employee work. Creates a task that runs in the background; poll it with get_task.",
    scope: "agents:run",
    readOnly: false,
    inputSchema: {
      type: "object",
      required: ["agentId", "input"],
      properties: {
        agentId: { type: "string", description: "Id from list_agents." },
        input: { type: "string", description: "Describe the work to do." },
        title: { type: "string", description: "Optional short task title." },
        mode: { type: "string", enum: ["live", "simulation"], description: "Default live. Live requires a published employee." },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
      },
    },
    run: (p, args) => {
      const { agentId, ...rest } = idArg("agentId").extend(agentRunBody.shape).parse(args);
      return runAgentForApi(p, agentId, agentRunBody.parse(rest));
    },
  },
  {
    name: "get_task",
    description: "Get the status, progress and result of a task created by run_agent.",
    scope: "tasks:read",
    readOnly: true,
    inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" } } },
    run: (p, args) => getTaskForApi(p.orgId, idArg("taskId").parse(args).taskId),
  },
  {
    name: "list_workflows",
    description: "List the company's workflows and whether each can be run (active with a published version).",
    scope: "workflows:read",
    readOnly: true,
    inputSchema: { type: "object", properties: {} },
    run: (p) => listWorkflowsForApi(p.orgId),
  },
  {
    name: "run_workflow",
    description: "Start a workflow's published version. Poll with get_workflow_run. Reuse idempotencyKey to make retries safe.",
    scope: "workflows:run",
    readOnly: false,
    inputSchema: {
      type: "object",
      required: ["workflowId"],
      properties: {
        workflowId: { type: "string", description: "Id from list_workflows." },
        input: { type: "object", description: "Workflow input values.", additionalProperties: true },
        idempotencyKey: { type: "string" },
      },
    },
    run: (p, args) => {
      const { workflowId, ...rest } = idArg("workflowId").extend(workflowRunBody.shape).parse(args);
      return runWorkflowForApi(p, workflowId, workflowRunBody.parse(rest), null);
    },
  },
  {
    name: "get_workflow_run",
    description: "Get the status and output of a workflow run started by run_workflow.",
    scope: "workflows:read",
    readOnly: true,
    inputSchema: { type: "object", required: ["runId"], properties: { runId: { type: "string" } } },
    run: (p, args) => getWorkflowRunForApi(p.orgId, idArg("runId").parse(args).runId),
  },
];

function toolResult(value: unknown, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError };
}

export async function callTool(p: ApiPrincipal, name: unknown, args: unknown) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  try {
    requireScope(p, tool.scope);
    return toolResult(await tool.run(p, args ?? {}));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return toolResult({ error: { code: "VALIDATION", message: err.issues.map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ") } }, true);
    }
    if (isAppError(err)) return toolResult({ error: { code: err.code, message: err.message } }, true);
    console.error("[mcp] tool error", err);
    return toolResult({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } }, true);
  }
}

type Id = string | number | null;
export interface RpcRequest {
  jsonrpc: "2.0";
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}

const rpcError = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0" as const, id, error: { code, message } });

/** Handles one JSON-RPC message. Returns `null` for notifications (no response). */
export async function handleMessage(p: ApiPrincipal, msg: unknown) {
  if (typeof msg !== "object" || msg === null || (msg as RpcRequest).jsonrpc !== "2.0" || typeof (msg as RpcRequest).method !== "string") {
    return rpcError(null, -32600, "Invalid JSON-RPC request.");
  }
  const { id, method, params } = msg as RpcRequest;
  if (id === undefined) return null; // notification, e.g. notifications/initialized
  const ok = (result: unknown) => ({ jsonrpc: "2.0" as const, id, result });

  switch (method) {
    case "initialize": {
      const asked = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (SUPPORTED_PROTOCOLS as readonly string[]).includes(asked) ? asked : SUPPORTED_PROTOCOLS[0];
      return ok({
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: "Manage a Virtual Desks Online workspace: list AI employees and workflows, give them work, and poll for results.",
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: TOOLS.filter((t) => p.scopes.includes(t.scope)).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: t.readOnly, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const result = await callTool(p, params?.name, params?.arguments);
      return result ? ok(result) : rpcError(id, -32602, `Unknown tool: ${String(params?.name)}`);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}
