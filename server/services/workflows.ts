import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { TriggerType } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/lib/auth/actor";
import { encryptSecret, randomToken } from "@/lib/security/crypto";
import { DEFAULT_SETTINGS, graphSchema, isTrigger, workflowSettingsSchema, type WorkflowGraph, type WorkflowSettings } from "@/lib/workflows/types";
import { graphFromRows } from "@/lib/workflows/validate-graph";
import { nextRunAt, tooFrequent } from "@/lib/workflows/schedule";
import { validateWorkflowGraph } from "@/server/workflows/validate";
import { startWorkflowRun } from "@/server/workflows/engine";
import { recordActivity, writeAudit } from "@/server/services/audit";

const TRIGGER_TYPE: Record<string, TriggerType> = {
  "trigger.manual": "MANUAL",
  "trigger.schedule": "SCHEDULE",
  "trigger.webhook": "WEBHOOK",
  "trigger.api": "API",
  "trigger.event": "EVENT",
};

export const STARTER_GRAPH: WorkflowGraph = {
  nodes: [{ key: "trigger", type: "trigger.manual", label: "Manual trigger", config: { inputFields: [] }, position: { x: 80, y: 160 } }],
  edges: [],
};

export async function getWorkflow(orgId: string, id: string) {
  const wf = await prisma.workflow.findFirst({ where: { id, orgId, deletedAt: null }, include: { department: { select: { name: true } } } });
  if (!wf) throw notFound("Workflow");
  return wf;
}

async function writeGraph(tx: Prisma.TransactionClient, versionId: string, graph: WorkflowGraph) {
  await tx.workflowEdge.deleteMany({ where: { versionId } });
  await tx.workflowNode.deleteMany({ where: { versionId } });
  if (graph.nodes.length) {
    await tx.workflowNode.createMany({
      data: graph.nodes.map((n) => ({ versionId, key: n.key, type: n.type, label: n.label, config: n.config as Prisma.InputJsonValue, positionX: n.position.x, positionY: n.position.y })),
    });
  }
  if (graph.edges.length) {
    await tx.workflowEdge.createMany({
      data: graph.edges.map((e) => ({ versionId, key: e.key, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, label: e.label ?? null })),
    });
  }
}

export async function createWorkflow(actor: Actor, input: { name: string; description?: string; departmentId?: string | null; graph?: WorkflowGraph; settings?: Partial<WorkflowSettings>; templateKey?: string; templateVersion?: number }) {
  const graph = graphSchema.parse(input.graph ?? STARTER_GRAPH) as WorkflowGraph;
  if (input.departmentId && !(await prisma.department.findFirst({ where: { id: input.departmentId, orgId: actor.orgId, deletedAt: null } }))) {
    throw notFound("Department");
  }
  const settings = workflowSettingsSchema.parse({ ...DEFAULT_SETTINGS, ...input.settings });
  // Never trust employee IDs from the caller: all must belong to this workspace.
  const referenced = new Set([...(settings.defaultAgentId ? [settings.defaultAgentId] : []), ...(graph.nodes.map((n) => (n.config as { agentId?: string }).agentId).filter(Boolean) as string[])]);
  if (referenced.size && (await prisma.agent.count({ where: { orgId: actor.orgId, deletedAt: null, id: { in: [...referenced] } } })) !== referenced.size) {
    throw new AppError("VALIDATION", "The workflow references an employee from outside this workspace.");
  }
  const trigger = graph.nodes.find((n) => isTrigger(n.type));
  const wf = await prisma.$transaction(async (tx) => {
    const wf = await tx.workflow.create({
      data: {
        orgId: actor.orgId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        departmentId: input.departmentId ?? null,
        triggerType: trigger ? TRIGGER_TYPE[trigger.type] : "MANUAL",
        templateKey: input.templateKey ?? null,
        templateVersion: input.templateVersion ?? null,
        createdById: actor.userId ?? null,
      },
    });
    const v = await tx.workflowVersion.create({ data: { orgId: actor.orgId, workflowId: wf.id, version: 1, status: "DRAFT", settings: settings as Prisma.InputJsonValue } });
    await writeGraph(tx, v.id, graph);
    if (settings.defaultAgentId) await tx.agentWorkflow.upsert({ where: { agentId_workflowId: { agentId: settings.defaultAgentId, workflowId: wf.id } }, create: { agentId: settings.defaultAgentId, workflowId: wf.id }, update: {} });
    return wf;
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "workflow.create", entityType: "Workflow", entityId: wf.id, metadata: { templateKey: input.templateKey } });
  return wf;
}

/** The editable version: the latest version if it's a draft, otherwise a new draft copied from it. */
export async function getDraft(orgId: string, workflowId: string) {
  await getWorkflow(orgId, workflowId);
  const latest = await prisma.workflowVersion.findFirstOrThrow({ where: { workflowId }, orderBy: { version: "desc" }, include: { nodes: true, edges: true } });
  return { version: latest, graph: graphFromRows(latest.nodes, latest.edges), settings: workflowSettingsSchema.parse(latest.settings ?? {}) };
}

export async function saveDraft(actor: Actor, workflowId: string, graphInput: unknown, settingsInput?: unknown) {
  const wf = await getWorkflow(actor.orgId, workflowId);
  const graph = graphSchema.parse(graphInput) as WorkflowGraph;
  const settings = workflowSettingsSchema.parse(settingsInput ?? {});
  if (settings.defaultAgentId && !(await prisma.agent.findFirst({ where: { id: settings.defaultAgentId, orgId: actor.orgId, deletedAt: null } }))) {
    throw new AppError("VALIDATION", "The default employee no longer exists.");
  }
  // Every referenced agent/tool must belong to this org (never trust IDs from the browser).
  const agentIds = graph.nodes.map((n) => (n.config as { agentId?: string }).agentId).filter(Boolean) as string[];
  if (agentIds.length && (await prisma.agent.count({ where: { orgId: actor.orgId, id: { in: [...new Set(agentIds)] } } })) !== new Set(agentIds).size) {
    throw new AppError("VALIDATION", "A step references an employee from outside this workspace.");
  }
  const latest = await prisma.workflowVersion.findFirstOrThrow({ where: { workflowId }, orderBy: { version: "desc" } });
  const trigger = graph.nodes.find((n) => isTrigger(n.type));

  const version = await prisma.$transaction(async (tx) => {
    let v = latest;
    if (latest.status !== "DRAFT") {
      // Editing a published workflow creates a new version; the published one keeps running untouched.
      v = await tx.workflowVersion.create({ data: { orgId: actor.orgId, workflowId, version: latest.version + 1, status: "DRAFT", settings: settings as Prisma.InputJsonValue } });
    } else {
      v = await tx.workflowVersion.update({ where: { id: latest.id }, data: { settings: settings as Prisma.InputJsonValue, lastSimulationOk: null, lastValidatedAt: null } });
    }
    await writeGraph(tx, v.id, graph);
    await tx.workflow.update({ where: { id: workflowId }, data: { draftVersion: v.version, ...(wf.publishedVersion === null && trigger ? { triggerType: TRIGGER_TYPE[trigger.type] } : {}) } });
    if (settings.defaultAgentId) {
      await tx.agentWorkflow.upsert({ where: { agentId_workflowId: { agentId: settings.defaultAgentId, workflowId } }, create: { agentId: settings.defaultAgentId, workflowId }, update: {} });
    }
    return v;
  });
  return version;
}

export async function updateWorkflowMeta(actor: Actor, workflowId: string, input: { name?: string; description?: string; departmentId?: string | null }) {
  await getWorkflow(actor.orgId, workflowId);
  await prisma.workflow.update({ where: { id: workflowId }, data: { name: input.name?.trim(), description: input.description, departmentId: input.departmentId === undefined ? undefined : input.departmentId } });
}

export async function validateDraft(orgId: string, workflowId: string, forPublish = false) {
  const { graph, settings, version } = await getDraft(orgId, workflowId);
  const issues = await validateWorkflowGraph(orgId, graph, { forPublish, defaultAgentId: settings.defaultAgentId });
  await prisma.workflowVersion.update({ where: { id: version.id }, data: { lastValidatedAt: new Date() } });
  return { issues, version };
}

export async function simulateDraft(actor: Actor, workflowId: string, payload: Record<string, unknown>) {
  const { issues, version } = await validateDraft(actor.orgId, workflowId, false);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) throw new AppError("VALIDATION", `Fix these first: ${errors.map((e) => e.message).join(" ")}`, { details: { issues } });
  return startWorkflowRun({ orgId: actor.orgId, workflowId, trigger: "MANUAL", payload, mode: "SIMULATION", versionId: version.id, createdById: actor.userId ?? null });
}

export async function publishWorkflow(actor: Actor, workflowId: string) {
  const wf = await getWorkflow(actor.orgId, workflowId);
  const { issues, version } = await validateDraft(actor.orgId, workflowId, true);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) throw new AppError("VALIDATION", errors.map((e) => e.message).join(" "), { details: { issues } });
  if (version.status !== "DRAFT") throw new AppError("CONFLICT", "This version is already published. Edit the workflow to create a new draft.");
  const fresh = await prisma.workflowVersion.findUniqueOrThrow({ where: { id: version.id } });
  if (!fresh.lastSimulationOk) {
    throw new AppError("VALIDATION", "Run a successful simulation of this version before publishing (Draft → Test → Publish).");
  }
  const { graph } = await getDraft(actor.orgId, workflowId);
  const trigger = graph.nodes.find((n) => isTrigger(n.type))!;
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: actor.orgId } });

  await prisma.$transaction(async (tx) => {
    await tx.workflowVersion.updateMany({ where: { workflowId, status: "PUBLISHED" }, data: { status: "SUPERSEDED" } });
    await tx.workflowVersion.update({ where: { id: version.id }, data: { status: "PUBLISHED", publishedAt: new Date(), publishedById: actor.userId ?? null } });
    await tx.workflow.update({ where: { id: workflowId }, data: { status: "ACTIVE", publishedVersion: version.version, triggerType: TRIGGER_TYPE[trigger.type] } });

    // Trigger plumbing
    await tx.schedule.deleteMany({ where: { workflowId } });
    if (trigger.type === "trigger.schedule") {
      const cfg = trigger.config as { cron: string; timezone?: string };
      const tz = cfg.timezone || org.timezone;
      if (tooFrequent(cfg.cron, tz)) throw new AppError("VALIDATION", "Schedules can run at most every 5 minutes.");
      await tx.schedule.create({ data: { orgId: actor.orgId, workflowId, name: wf.name, cron: cfg.cron, timezone: tz, nextRunAt: nextRunAt(cfg.cron, tz) } });
    }
    if (trigger.type === "trigger.webhook") {
      const existing = await tx.webhook.findFirst({ where: { workflowId } });
      const requireSignature = (trigger.config as { requireSignature?: boolean }).requireSignature ?? true;
      if (existing) await tx.webhook.update({ where: { id: existing.id }, data: { enabled: true, requireSignature } });
      else await tx.webhook.create({ data: { orgId: actor.orgId, workflowId, key: randomToken(18), secretCiphertext: encryptSecret(`whsec_${randomToken(24)}`), requireSignature } });
    } else {
      await tx.webhook.updateMany({ where: { workflowId }, data: { enabled: false } });
    }
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "workflow.publish", entityType: "Workflow", entityId: workflowId, metadata: { version: version.version } });
  await recordActivity({ orgId: actor.orgId, category: "WORKFLOW", actorType: "USER", actorUserId: actor.userId, summary: `${wf.name} v${version.version} was published.`, entityType: "Workflow", entityId: workflowId, link: `/workflows/${workflowId}` });
  return { version: version.version, warnings: issues.filter((i) => i.level === "warning") };
}

export async function setWorkflowPaused(actor: Actor, workflowId: string, paused: boolean) {
  const wf = await getWorkflow(actor.orgId, workflowId);
  if (wf.publishedVersion === null) throw new AppError("VALIDATION", "Publish the workflow first.");
  await prisma.$transaction([
    prisma.workflow.update({ where: { id: workflowId }, data: { status: paused ? "PAUSED" : "ACTIVE" } }),
    prisma.schedule.updateMany({ where: { workflowId }, data: { enabled: !paused } }),
    prisma.webhook.updateMany({ where: { workflowId }, data: { enabled: !paused } }),
  ]);
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: paused ? "workflow.pause" : "workflow.resume", entityType: "Workflow", entityId: workflowId });
}

export async function archiveWorkflow(actor: Actor, workflowId: string) {
  await getWorkflow(actor.orgId, workflowId);
  await prisma.$transaction([
    prisma.workflow.update({ where: { id: workflowId }, data: { status: "ARCHIVED", deletedAt: new Date() } }),
    prisma.schedule.deleteMany({ where: { workflowId } }),
    prisma.webhook.updateMany({ where: { workflowId }, data: { enabled: false } }),
  ]);
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "workflow.delete", entityType: "Workflow", entityId: workflowId });
}

export async function duplicateWorkflow(actor: Actor, workflowId: string) {
  const wf = await getWorkflow(actor.orgId, workflowId);
  const { graph, settings } = await getDraft(actor.orgId, workflowId);
  return createWorkflow(actor, { name: `${wf.name} (copy)`, description: wf.description ?? undefined, departmentId: wf.departmentId, graph, settings });
}

export async function runWorkflowNow(actor: Actor, workflowId: string, payload: Record<string, unknown>, trigger: TriggerType = "MANUAL", idempotencyKey?: string) {
  return startWorkflowRun({ orgId: actor.orgId, workflowId, trigger, payload, mode: "LIVE", createdById: actor.userId ?? null, apiKeyId: actor.apiKeyId ?? null, idempotencyKey });
}
