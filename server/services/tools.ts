import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError, notFound } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { RiskLevel } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/lib/auth/actor";
import { httpConfigSchema, httpInputJsonSchema, type HttpConfig } from "@/lib/tools/http-config";
import { assertSafeUrl } from "@/lib/security/ssrf";
import { redact } from "@/lib/security/redact";
import { getToolDefinition } from "@/lib/tools/registry";
import { decryptSecret } from "@/lib/security/crypto";
import { runHttpTool } from "@/server/tools/executor";
import { validateToolInput } from "@/server/tools/validate";
import { writeAudit } from "@/server/services/audit";
import type { ToolResult } from "@/lib/tools/types";

export interface CustomToolInput {
  name: string;
  key: string;
  description: string;
  riskLevel: RiskLevel;
  capabilities: string[];
  httpConfig: unknown;
}

function slugKey(key: string) {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

async function validateCustom(orgId: string, input: CustomToolInput): Promise<{ cfg: HttpConfig; key: string }> {
  const parsed = httpConfigSchema.safeParse(input.httpConfig);
  if (!parsed.success) {
    throw new AppError("VALIDATION", parsed.error.issues.map((i) => i.message).join(" "), {
      fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [`httpConfig.${i.path.join(".")}`, i.message])),
    });
  }
  const cfg = parsed.data;
  // Validate the URL shape now; the host is re-checked at connect time on every call.
  assertSafeUrl(cfg.url.replace(/\{[^}]+\}/g, "x"), env().ALLOW_PRIVATE_NETWORK_TOOLS);
  if (cfg.auth.credentialId) {
    const cred = await prisma.toolCredential.findFirst({ where: { id: cfg.auth.credentialId, orgId, revokedAt: null } });
    if (!cred) throw new AppError("VALIDATION", "The selected credential doesn't exist or was revoked.");
  }
  const key = `custom.${slugKey(input.key || input.name)}`;
  if (key === "custom.") throw new AppError("VALIDATION", "Give the tool a name.");
  return { cfg, key };
}

export async function createCustomTool(actor: Actor, input: CustomToolInput) {
  const { cfg, key } = await validateCustom(actor.orgId, input);
  const exists = await prisma.tool.findFirst({ where: { orgId: actor.orgId, key } });
  if (exists && !exists.deletedAt) throw new AppError("CONFLICT", `A tool with the key "${key}" already exists.`, { fieldErrors: { key: "Key already used." } });
  const data = {
    name: input.name.trim(),
    description: input.description.trim(),
    kind: "CUSTOM_HTTP" as const,
    integrationKey: "custom_http",
    riskLevel: input.riskLevel,
    capabilities: input.capabilities,
    inputSchema: httpInputJsonSchema(cfg.parameters) as Prisma.InputJsonValue,
    httpConfig: cfg as unknown as Prisma.InputJsonValue,
    credentialId: cfg.auth.credentialId ?? null,
    isSimulated: false,
    enabled: true,
  };
  const tool = exists
    ? await prisma.tool.update({ where: { id: exists.id }, data: { ...data, deletedAt: null, version: { increment: 1 } } })
    : await prisma.tool.create({ data: { ...data, orgId: actor.orgId, key, createdById: actor.userId ?? null } });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "tool.create", entityType: "Tool", entityId: tool.id, metadata: { key, method: cfg.method, url: cfg.url, risk: input.riskLevel } });
  return tool;
}

export async function updateCustomTool(actor: Actor, toolId: string, input: CustomToolInput) {
  const tool = await prisma.tool.findFirst({ where: { id: toolId, orgId: actor.orgId, deletedAt: null } });
  if (!tool) throw notFound("Tool");
  if (tool.kind !== "CUSTOM_HTTP") throw new AppError("VALIDATION", "Built-in tools can't be edited.");
  const { cfg } = await validateCustom(actor.orgId, { ...input, key: tool.key.replace(/^custom\./, "") });
  const updated = await prisma.tool.update({
    where: { id: toolId },
    data: {
      name: input.name.trim(),
      description: input.description.trim(),
      riskLevel: input.riskLevel,
      capabilities: input.capabilities,
      inputSchema: httpInputJsonSchema(cfg.parameters) as Prisma.InputJsonValue,
      httpConfig: cfg as unknown as Prisma.InputJsonValue,
      credentialId: cfg.auth.credentialId ?? null,
      version: { increment: 1 },
    },
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "tool.update", entityType: "Tool", entityId: toolId, metadata: { version: updated.version, risk: input.riskLevel } });
  return updated;
}

export async function setToolEnabled(actor: Actor, toolId: string, enabled: boolean) {
  const tool = await prisma.tool.findFirst({ where: { id: toolId, orgId: actor.orgId, deletedAt: null } });
  if (!tool) throw notFound("Tool");
  await prisma.tool.update({ where: { id: toolId }, data: { enabled } });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: enabled ? "tool.enable" : "tool.disable", entityType: "Tool", entityId: toolId });
}

/** Raising a built-in tool's risk (never lowering below the registry's level). */
export async function setToolRisk(actor: Actor, toolId: string, riskLevel: RiskLevel) {
  const tool = await prisma.tool.findFirst({ where: { id: toolId, orgId: actor.orgId, deletedAt: null } });
  if (!tool) throw notFound("Tool");
  await prisma.tool.update({ where: { id: toolId }, data: { riskLevel } });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "tool.risk.update", entityType: "Tool", entityId: toolId, metadata: { riskLevel } });
}

export async function deleteTool(actor: Actor, toolId: string) {
  const tool = await prisma.tool.findFirst({ where: { id: toolId, orgId: actor.orgId, deletedAt: null } });
  if (!tool) throw notFound("Tool");
  if (tool.kind !== "CUSTOM_HTTP") throw new AppError("VALIDATION", "Disconnect the integration to remove built-in tools.");
  await prisma.$transaction([prisma.agentTool.deleteMany({ where: { toolId } }), prisma.tool.update({ where: { id: toolId }, data: { deletedAt: new Date(), enabled: false } })]);
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "tool.delete", entityType: "Tool", entityId: toolId });
}

/**
 * Admin-run tool test (not an agent action). Built-in mock tools run for real
 * (their effects stay inside Virtual Desks Online); custom tools call the real API — so non-GET
 * tests can have real side effects and the UI warns about that.
 */
export async function testTool(actor: Actor, toolId: string, input: unknown, mode: "LIVE" | "SIMULATION"): Promise<ToolResult & { latencyMs: number }> {
  const tool = await prisma.tool.findFirst({ where: { id: toolId, orgId: actor.orgId, deletedAt: null } });
  if (!tool) throw notFound("Tool");
  const validInput = await validateToolInput(actor.orgId, tool.key, input);
  const started = Date.now();
  const ctx = { orgId: actor.orgId, agentId: null, runId: null, mode, idempotencyKey: `test:${Date.now()}`, secret: null as string | null };
  let result: ToolResult;
  try {
    if (tool.kind === "BUILTIN") {
      const def = getToolDefinition(tool.key);
      if (!def) throw new AppError("NOT_CONFIGURED", "No handler registered.");
      result = mode === "SIMULATION" ? await def.simulate(validInput, ctx) : await def.execute(validInput, ctx);
    } else {
      if (tool.credentialId) {
        const cred = await prisma.toolCredential.findFirst({ where: { id: tool.credentialId, orgId: actor.orgId, revokedAt: null } });
        if (!cred) throw new AppError("NOT_CONFIGURED", "The tool's credential was revoked.");
        ctx.secret = decryptSecret(cred.ciphertext);
      }
      if (mode === "SIMULATION") {
        result = { output: { wouldCall: tool.key, input: validInput }, summary: "Simulation — no request was sent.", simulated: true };
      } else {
        result = await runHttpTool(tool, validInput, ctx);
      }
    }
    await prisma.tool.update({ where: { id: toolId }, data: { lastTestedAt: new Date(), lastTestOk: true } });
    await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "tool.test", toolKey: tool.key, metadata: { mode, input: redact(validInput), summary: result.summary } });
    return { ...result, latencyMs: Date.now() - started };
  } catch (err) {
    await prisma.tool.update({ where: { id: toolId }, data: { lastTestedAt: new Date(), lastTestOk: false } });
    await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "tool.test", toolKey: tool.key, outcome: "FAILED", metadata: { mode, error: String((err as Error).message) } });
    throw err;
  }
}
