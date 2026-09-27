import type { z } from "zod";
import { prisma } from "@/lib/db";
import { getDisabled } from "@/server/services/platform-settings";
import { env } from "@/lib/env";
import type { Prisma, Tool } from "@/lib/generated/prisma/client";
import type { ExecutionMode, PermissionEffect, RiskLevel } from "@/lib/generated/prisma/enums";
import { AppError, isAppError } from "@/lib/errors";
import type { JsonSchema } from "@/lib/ai/types";
import { evaluatePermission, type PermissionDecision } from "@/lib/permissions/engine";
import { getToolDefinition, zodToJsonSchema } from "@/lib/tools/registry";
import { buildHttpRequest, httpConfigSchema, httpInputJsonSchema, httpInputZod, pickPath } from "@/lib/tools/http-config";
import type { ToolExecutionContext, ToolResult } from "@/lib/tools/types";
import { decryptSecret } from "@/lib/security/crypto";
import { getValidAccessToken } from "@/lib/integrations/oauth/tokens";
import { providerForIntegration } from "@/lib/integrations/oauth/providers";
import { redact, summarizeForLog } from "@/lib/security/redact";
import { safeHttpRequest } from "@/lib/security/ssrf";
import { applicableApprovalRules, applicablePolicies, internalDomains } from "@/server/services/permissions";
import { writeAudit } from "@/server/services/audit";

export type ToolRow = Tool;

const RISK_ORDER: Record<RiskLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/** Effective risk/capabilities: the registry definition can never be weakened by DB edits. */
export function effectiveToolMeta(tool: ToolRow): { riskLevel: RiskLevel; capabilities: string[] } {
  const def = tool.kind === "BUILTIN" ? getToolDefinition(tool.key) : undefined;
  if (!def) return { riskLevel: tool.riskLevel, capabilities: tool.capabilities };
  return {
    riskLevel: RISK_ORDER[tool.riskLevel] >= RISK_ORDER[def.riskLevel] ? tool.riskLevel : def.riskLevel,
    capabilities: [...new Set([...def.capabilities, ...tool.capabilities])],
  };
}

export function toolInputJsonSchema(tool: ToolRow): JsonSchema {
  if (tool.kind === "BUILTIN") {
    const def = getToolDefinition(tool.key);
    if (def) return zodToJsonSchema(def.inputSchema);
  }
  if (tool.kind === "CUSTOM_HTTP" && tool.httpConfig) {
    const cfg = httpConfigSchema.parse(tool.httpConfig);
    return httpInputJsonSchema(cfg.parameters);
  }
  return (tool.inputSchema as JsonSchema) ?? { type: "object", properties: {} };
}

function inputValidator(tool: ToolRow): z.ZodType {
  if (tool.kind === "BUILTIN") {
    const def = getToolDefinition(tool.key);
    if (!def) throw new AppError("NOT_CONFIGURED", `${tool.name} has no registered handler.`);
    return def.inputSchema;
  }
  if (tool.kind === "CUSTOM_HTTP") return httpInputZod(httpConfigSchema.parse(tool.httpConfig).parameters);
  throw new AppError("NOT_CONFIGURED", `${tool.name} can't be executed directly.`);
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export interface ExecuteToolParams {
  orgId: string;
  /** Agent acting. null = a workflow step without an assigned employee. */
  agentId: string | null;
  runId: string | null;
  workflowRunId?: string | null;
  toolKey: string;
  input: unknown;
  mode: ExecutionMode;
  idempotencyKey: string;
  /** Grant recorded in the executing agent version; undefined for draft/simulation runs. */
  snapshotGrant?: PermissionEffect | null;
  /** Set when a human already approved this exact action. */
  approvalId?: string | null;
  signal?: AbortSignal;
}

export type ExecuteToolOutcome =
  | { status: "EXECUTED" | "SIMULATED"; result: ToolResult; decision: PermissionDecision; deduplicated?: boolean }
  | { status: "REQUIRES_APPROVAL"; decision: PermissionDecision; input: Record<string, unknown>; tool: ToolRow; riskLevel: RiskLevel }
  | { status: "DENIED"; decision: PermissionDecision; error: string }
  | { status: "FAILED"; error: string; retryable: boolean; decision?: PermissionDecision };

export async function executeTool(p: ExecuteToolParams): Promise<ExecuteToolOutcome> {
  const tool = await prisma.tool.findFirst({ where: { orgId: p.orgId, key: p.toolKey } });
  if (!tool) return { status: "FAILED", error: `Tool "${p.toolKey}" is not available in this workspace.`, retryable: false };

  // 1. Validate input against the tool schema.
  let input: Record<string, unknown>;
  try {
    input = inputValidator(tool).parse(p.input ?? {}) as Record<string, unknown>;
  } catch (err) {
    const msg = err && typeof err === "object" && "issues" in err ? (err as z.ZodError).issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") : String(err);
    return { status: "FAILED", error: `Invalid input for ${tool.name}: ${msg}`, retryable: false };
  }

  // 2. Runtime permission check.
  const agent = p.agentId ? await prisma.agent.findFirst({ where: { id: p.agentId, orgId: p.orgId }, include: { tools: { where: { toolId: tool.id } } } }) : null;
  if (p.agentId && !agent) return { status: "FAILED", error: "Employee not found.", retryable: false };
  const meta = effectiveToolMeta(tool);
  const connection = tool.connectionId ? await prisma.integrationConnection.findUnique({ where: { id: tool.connectionId } }) : null;
  const platformDisabled = !!tool.integrationKey && (await getDisabled("integrations.disabled")).includes(tool.integrationKey);
  const [policies, rules, domains] = await Promise.all([
    applicablePolicies(p.orgId, agent?.id ?? "", agent?.departmentId ?? null),
    applicableApprovalRules(p.orgId, agent?.id ?? "", agent?.departmentId ?? null),
    internalDomains(p.orgId),
  ]);
  const liveGrant: PermissionEffect | null = agent
    ? (agent.tools[0]?.effect ?? null)
    : meta.riskLevel === "LOW"
      ? "ALLOW"
      : "REQUIRE_APPROVAL"; // workflow step with no employee: anything beyond low risk needs a human
  const decision = evaluatePermission({
    tool: { key: tool.key, name: tool.name, riskLevel: meta.riskLevel, capabilities: meta.capabilities, enabled: tool.enabled && !platformDisabled && (!connection || connection.status === "CONNECTED"), deleted: !!tool.deletedAt },
    liveGrant,
    snapshotGrant: agent ? p.snapshotGrant : undefined,
    agentPaused: agent?.status === "PAUSED",
    policies,
    approvalRules: rules,
    action: { toolKey: tool.key, capabilities: meta.capabilities, risk: meta.riskLevel, input, agentId: agent?.id ?? "", departmentId: agent?.departmentId ?? null, internalDomains: domains },
  });

  const auditBase = {
    orgId: p.orgId,
    actorType: agent ? ("AGENT" as const) : ("SYSTEM" as const),
    actorAgentId: agent?.id ?? null,
    action: "tool.execute",
    toolKey: tool.key,
    runId: p.runId ?? undefined,
    workflowRunId: p.workflowRunId ?? undefined,
  };

  if (decision.outcome === "DENY") {
    await writeAudit({ ...auditBase, outcome: "DENIED", metadata: { reasons: decision.reasons, input: redact(input), mode: p.mode } });
    return { status: "DENIED", decision, error: decision.reasons.join(" ") || "Not permitted." };
  }

  if (decision.outcome === "REQUIRE_APPROVAL") {
    const approved = p.approvalId ? await verifyApproval(p, tool.key, input) : false;
    if (!approved) {
      return { status: "REQUIRES_APPROVAL", decision, input, tool, riskLevel: meta.riskLevel };
    }
  }

  // 3. Simulation mode never produces side effects.
  const secret = await loadSecret(tool, connection?.credentialId ?? null);
  const ctx: ToolExecutionContext = {
    orgId: p.orgId,
    agentId: agent?.id ?? null,
    runId: p.runId,
    workflowRunId: p.workflowRunId ?? null,
    mode: p.mode,
    secret,
    connectionConfig: (connection?.config as Record<string, unknown> | null) ?? null,
    idempotencyKey: p.idempotencyKey,
    signal: p.signal,
  };

  if (p.mode === "SIMULATION") {
    const result = await simulateTool(tool, input, ctx);
    await writeAudit({ ...auditBase, action: "tool.simulate", metadata: { input: redact(input), summary: result.summary } });
    return { status: "SIMULATED", result, decision };
  }

  // 4. Idempotency guard for live execution.
  const def = tool.kind === "BUILTIN" ? getToolDefinition(tool.key) : undefined;
  const idempotent = def ? def.idempotent : tool.kind === "CUSTOM_HTTP" ? (httpConfigSchema.parse(tool.httpConfig).method === "GET") : false;
  const existing = await prisma.idempotencyRecord.findUnique({ where: { orgId_scope_key: { orgId: p.orgId, scope: "tool", key: p.idempotencyKey } } });
  if (existing?.status === "COMPLETED") {
    return { status: "EXECUTED", result: existing.response as unknown as ToolResult, decision, deduplicated: true };
  }
  if (existing?.status === "STARTED" && !idempotent) {
    await writeAudit({ ...auditBase, outcome: "FAILED", metadata: { reason: "outcome_unknown", input: redact(input) } });
    return {
      status: "FAILED",
      error: `A previous attempt of ${tool.name} may or may not have completed. It was not retried automatically to avoid a duplicate action — a human needs to check.`,
      retryable: false,
      decision,
    };
  }
  if (existing) await prisma.idempotencyRecord.update({ where: { id: existing.id }, data: { status: "STARTED" } });
  else {
    try {
      await prisma.idempotencyRecord.create({ data: { orgId: p.orgId, scope: "tool", key: p.idempotencyKey, status: "STARTED" } });
    } catch {
      return { status: "FAILED", error: `${tool.name} is already running for this step.`, retryable: true, decision };
    }
  }

  const started = Date.now();
  try {
    const result = await runTool(tool, input, ctx);
    await prisma.idempotencyRecord.update({
      where: { orgId_scope_key: { orgId: p.orgId, scope: "tool", key: p.idempotencyKey } },
      data: { status: "COMPLETED", response: result as unknown as Prisma.InputJsonValue },
    });
    await Promise.all([
      writeAudit({ ...auditBase, metadata: { input: redact(input), summary: result.summary, simulated: result.simulated, latencyMs: Date.now() - started, approvalId: p.approvalId } }),
      prisma.usageRecord.create({ data: { orgId: p.orgId, kind: "TOOL_CALL", agentId: agent?.id, runId: p.runId, workflowRunId: p.workflowRunId ?? undefined, quantity: 1 } }),
      tool.credentialId || connection?.credentialId
        ? prisma.toolCredential.updateMany({ where: { id: { in: [tool.credentialId, connection?.credentialId].filter(Boolean) as string[] } }, data: { lastUsedAt: new Date() } })
        : Promise.resolve(),
    ]);
    return { status: "EXECUTED", result, decision };
  } catch (err) {
    // The request definitely failed (we got an error back): allow a later retry.
    await prisma.idempotencyRecord.update({
      where: { orgId_scope_key: { orgId: p.orgId, scope: "tool", key: p.idempotencyKey } },
      data: { status: "FAILED" },
    });
    const message = isAppError(err) ? err.message : `${tool.name} failed: ${String((err as Error)?.message ?? err).slice(0, 300)}`;
    await writeAudit({ ...auditBase, outcome: "FAILED", metadata: { input: redact(input), error: message } });
    return { status: "FAILED", error: message, retryable: idempotent || (isAppError(err) && err.code === "INTEGRATION_ERROR"), decision };
  }
}

async function verifyApproval(p: ExecuteToolParams, toolKey: string, input: Record<string, unknown>): Promise<boolean> {
  const approval = await prisma.approval.findFirst({ where: { id: p.approvalId!, orgId: p.orgId } });
  if (!approval || approval.status !== "APPROVED" || approval.toolKey !== toolKey) return false;
  if (p.runId && approval.agentRunId && approval.agentRunId !== p.runId) return false;
  if (p.workflowRunId && approval.workflowRunId && approval.workflowRunId !== p.workflowRunId) return false;
  // The executed input must be exactly what the human approved (possibly edited).
  const approvedInput = (approval.editedInput ?? approval.proposedInput) as unknown;
  return stableStringify(approvedInput) === stableStringify(input);
}

async function loadSecret(tool: ToolRow, connectionCredentialId: string | null): Promise<string | null> {
  const credId = tool.credentialId ?? connectionCredentialId;
  if (!credId) return null;
  const cred = await prisma.toolCredential.findFirst({ where: { id: credId, orgId: tool.orgId, revokedAt: null } });
  if (!cred) throw new AppError("NOT_CONFIGURED", `The credential for ${tool.name} was revoked or removed.`);
  if (cred.type === "OAUTH2") {
    const provider = tool.integrationKey ? providerForIntegration(tool.integrationKey) : null;
    if (!provider) throw new AppError("NOT_CONFIGURED", `${tool.name} has an OAuth credential but no known provider.`);
    return getValidAccessToken(cred.id, provider);
  }
  return decryptSecret(cred.ciphertext);
}

async function runTool(tool: ToolRow, input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
  if (tool.kind === "BUILTIN") {
    const def = getToolDefinition(tool.key);
    if (!def) throw new AppError("NOT_CONFIGURED", `${tool.name} has no registered handler.`);
    return def.execute(input, ctx);
  }
  if (tool.kind === "CUSTOM_HTTP") return runHttpTool(tool, input, ctx);
  throw new AppError("NOT_CONFIGURED", `${tool.name} can't be executed.`);
}

async function simulateTool(tool: ToolRow, input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
  if (tool.kind === "BUILTIN") {
    const def = getToolDefinition(tool.key);
    if (!def) throw new AppError("NOT_CONFIGURED", `${tool.name} has no registered handler.`);
    return def.simulate(input, ctx);
  }
  if (tool.kind === "CUSTOM_HTTP") {
    const cfg = httpConfigSchema.parse(tool.httpConfig);
    const req = buildHttpRequest(cfg, input, null);
    // GET requests are safe to preview live? No — simulation never calls external systems.
    return { output: { wouldRequest: { method: req.method, url: req.url }, simulated: true }, summary: `Would call ${req.method} ${new URL(req.url).host}`, simulated: true };
  }
  throw new AppError("NOT_CONFIGURED", `${tool.name} can't be simulated.`);
}

export async function runHttpTool(tool: ToolRow, input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const cfg = httpConfigSchema.parse(tool.httpConfig);
  const req = buildHttpRequest(cfg, input, ctx.secret);
  const res = await safeHttpRequest({ ...req, timeoutMs: cfg.timeoutMs, allowPrivate: env().ALLOW_PRIVATE_NETWORK_TOOLS });
  let data: unknown = res.body;
  try {
    data = JSON.parse(res.body);
  } catch {
    /* non-JSON response */
  }
  if (res.status >= 400) {
    throw new AppError("INTEGRATION_ERROR", `${tool.name} returned HTTP ${res.status}: ${String(summarizeForLog(data, 300) as unknown as string).slice(0, 300)}`);
  }
  const output = pickPath(data, cfg.responsePath);
  return {
    output: { status: res.status, data: output, truncated: res.truncated },
    summary: `${cfg.method} ${new URL(req.url).host} → ${res.status} (${res.durationMs} ms)`,
    simulated: false,
  };
}
