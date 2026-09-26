import { prisma } from "@/lib/db";
import { assertIntegrationEnabled, getDisabled } from "@/server/services/platform-settings";
import { AppError, notFound } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { getIntegration, INTEGRATIONS } from "@/lib/integrations/catalog";
import { MOCK_SEED } from "@/lib/integrations/mock/tools";
import { toolsForIntegration, zodToJsonSchema } from "@/lib/tools/registry";
import { recordActivity, writeAudit } from "@/server/services/audit";

export async function listIntegrations(orgId: string) {
  const [connections, disabled] = await Promise.all([
    prisma.integrationConnection.findMany({ where: { orgId }, include: { _count: { select: { tools: true } } } }),
    getDisabled("integrations.disabled"),
  ]);
  return INTEGRATIONS.map((i) => {
    const conn = connections.find((c) => c.integrationKey === i.key);
    return {
      ...i,
      disabledByPlatform: disabled.includes(i.key),
      connection: conn ? { id: conn.id, status: conn.status, isSimulated: conn.isSimulated, connectedAt: conn.connectedAt.toISOString(), tools: conn._count.tools, lastError: conn.lastError } : null,
    };
  });
}

/**
 * Connects an integration. Today only simulated demo integrations can be
 * connected directly; providers needing OAuth report exactly what's missing.
 */
export async function connectIntegration(actor: Actor, key: string) {
  const info = getIntegration(key);
  if (!info) throw notFound("Integration");
  await assertIntegrationEnabled(key);
  if (info.availability === "coming_soon") throw new AppError("NOT_CONFIGURED", `${info.name} is coming soon and can't be connected yet.`);
  if (info.availability === "requires_setup") {
    throw new AppError(
      "NOT_CONFIGURED",
      `${info.name} is not configured on this platform. The operator must register an OAuth app and set ${info.setupEnv?.join(" and ")}.`,
    );
  }
  if (!info.simulated) throw new AppError("VALIDATION", `${info.name} is set up from its own page.`);

  const defs = toolsForIntegration(key);
  const connection = await prisma.$transaction(async (tx) => {
    const conn = await tx.integrationConnection.upsert({
      where: { orgId_integrationKey: { orgId: actor.orgId, integrationKey: key } },
      create: { orgId: actor.orgId, integrationKey: key, name: info.name, status: "CONNECTED", isSimulated: true, connectedById: actor.userId ?? null },
      update: { status: "CONNECTED", lastError: null },
    });
    for (const def of defs) {
      await tx.tool.upsert({
        where: { orgId_key: { orgId: actor.orgId, key: def.key } },
        create: {
          orgId: actor.orgId,
          key: def.key,
          name: def.name,
          description: def.description,
          kind: "BUILTIN",
          integrationKey: key,
          connectionId: conn.id,
          riskLevel: def.riskLevel,
          capabilities: def.capabilities,
          inputSchema: zodToJsonSchema(def.inputSchema) as Prisma.InputJsonValue,
          isSimulated: true,
          createdById: actor.userId ?? null,
        },
        update: { enabled: true, deletedAt: null, connectionId: conn.id },
      });
    }
    const existing = await tx.mockRecord.count({ where: { orgId: actor.orgId, integrationKey: key } });
    if (existing === 0) {
      for (const seed of MOCK_SEED[key] ?? []) {
        await tx.mockRecord.create({ data: { orgId: actor.orgId, integrationKey: key, collection: seed.collection, data: seed.data as Prisma.InputJsonValue } });
      }
    }
    return conn;
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "integration.connect", entityType: "IntegrationConnection", entityId: connection.id, metadata: { key } });
  await recordActivity({
    orgId: actor.orgId,
    category: "INTEGRATION",
    actorType: actor.type === "USER" ? "USER" : "SYSTEM",
    actorUserId: actor.userId,
    summary: `${info.name} connected (simulated).`,
    detail: `${defs.length} tools available to AI employees.`,
    link: "/integrations",
  });
  return connection;
}

export async function disconnectIntegration(actor: Actor, key: string) {
  const conn = await prisma.integrationConnection.findUnique({ where: { orgId_integrationKey: { orgId: actor.orgId, integrationKey: key } } });
  if (!conn) throw notFound("Connection");
  await prisma.$transaction([
    prisma.integrationConnection.update({ where: { id: conn.id }, data: { status: "DISCONNECTED" } }),
    // Tools stay assigned (so reconnecting restores access) but can't execute.
    prisma.tool.updateMany({ where: { orgId: actor.orgId, connectionId: conn.id }, data: { enabled: false } }),
  ]);
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "integration.disconnect", entityType: "IntegrationConnection", entityId: conn.id, metadata: { key } });
  await recordActivity({
    orgId: actor.orgId,
    category: "INTEGRATION",
    actorType: "USER",
    actorUserId: actor.userId,
    summary: `${conn.name} disconnected.`,
    link: "/integrations",
  });
}
