import { prisma } from "@/lib/db";
import { isOpenModelProvider } from "@/lib/ai/provider-presets";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { assertTemplateEnabled } from "@/server/services/platform-settings";
import { AppError, notFound } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { AgentStatus, InstructionSection } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/lib/auth/actor";
import { createAgentSchema, onlySent, type CreateAgentData, type CreateAgentInput, type InstructionKey } from "@/lib/agents/schema";
import type { AgentSnapshot } from "@/lib/agents/snapshot";
import { getAgentTemplate } from "@/lib/templates/agents";
import { PROVIDER_LABELS, getModel } from "@/lib/ai/models";
import { defaultModelFor, resolveProviderCredentials } from "@/server/services/ai-providers";
import { recordActivity, writeAudit } from "@/server/services/audit";

const agentInclude = {
  department: true,
  instructions: true,
  providerConfig: true,
  tools: { include: { tool: true } },
  knowledge: { include: { knowledgeBase: true } },
  workflows: { include: { workflow: true } },
  delegatesTo: true,
} satisfies Prisma.AgentInclude;

export type AgentWithConfig = Prisma.AgentGetPayload<{ include: typeof agentInclude }>;

/** Loads an agent scoped to the organization. Throws NOT_FOUND for other tenants' IDs. */
export async function getAgent(orgId: string, agentId: string): Promise<AgentWithConfig> {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, orgId, deletedAt: null }, include: agentInclude });
  if (!agent) throw notFound("AI employee");
  return agent;
}

async function assertOwned(orgId: string, data: Pick<CreateAgentData, "departmentId" | "knowledgeBaseIds" | "tools" | "workflowIds">) {
  if (data.departmentId) {
    const dept = await prisma.department.findFirst({ where: { id: data.departmentId, orgId, deletedAt: null } });
    if (!dept) throw new AppError("VALIDATION", "That department doesn't exist.", { fieldErrors: { departmentId: "Choose a department." } });
  }
  const check = async (count: Promise<number>, expected: number, what: string) => {
    if ((await count) !== expected) throw new AppError("VALIDATION", `One or more selected ${what} are not available in this workspace.`);
  };
  const kbIds = [...new Set(data.knowledgeBaseIds)];
  const toolIds = [...new Set(data.tools.map((t) => t.toolId))];
  const wfIds = [...new Set(data.workflowIds)];
  await Promise.all([
    kbIds.length && check(prisma.knowledgeBase.count({ where: { orgId, id: { in: kbIds }, deletedAt: null } }), kbIds.length, "knowledge collections"),
    toolIds.length && check(prisma.tool.count({ where: { orgId, id: { in: toolIds }, deletedAt: null } }), toolIds.length, "tools"),
    wfIds.length && check(prisma.workflow.count({ where: { orgId, id: { in: wfIds }, deletedAt: null } }), wfIds.length, "workflows"),
  ]);
}

/** Plan entitlement: how many AI employees a company can have. */
async function assertAgentLimit(orgId: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { plan: true } });
  const limit = entitlementsFor(org.plan).agents;
  if (limit === null) return;
  const count = await prisma.agent.count({ where: { orgId, deletedAt: null } });
  if (count >= limit) throw new AppError("LIMIT_EXCEEDED", `Your plan includes up to ${limit} AI employees. Archive one or upgrade to hire more.`);
}

export async function createAgent(actor: Actor, input: CreateAgentInput) {
  const data = createAgentSchema.parse(input);
  await assertAgentLimit(actor.orgId);
  await assertOwned(actor.orgId, data);
  const model = data.model ?? { ...(await defaultModelFor(actor.orgId)), temperature: 0.3, maxOutputTokens: 4000 };

  const agent = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: {
        orgId: actor.orgId,
        name: data.name,
        jobTitle: data.jobTitle,
        departmentId: data.departmentId || null,
        description: data.description || null,
        avatarColor: data.avatarColor,
        mission: data.mission || null,
        responsibilities: data.responsibilities,
        goals: data.goals,
        kpis: data.kpis,
        priority: data.priority,
        personality: data.personality,
        personalityNotes: data.personalityNotes || null,
        status: "ACTIVE",
        lifecycle: "DRAFT",
        templateKey: data.templateKey ?? null,
        templateVersion: data.templateKey ? (getAgentTemplate(data.templateKey)?.version ?? null) : null,
        createdById: actor.userId ?? null,
        ...data.limits,
        providerConfig: {
          create: {
            provider: model.provider,
            model: model.model,
            fallbackProvider: model.fallbackProvider ?? null,
            fallbackModel: model.fallbackModel ?? null,
            temperature: model.temperature ?? 0.3,
            maxOutputTokens: model.maxOutputTokens ?? 4000,
          },
        },
        instructions: {
          create: Object.entries(data.instructions)
            .filter(([, content]) => content && content.trim())
            .map(([section, content]) => ({ section: section as InstructionSection, content: content!.trim() })),
        },
        knowledge: { create: data.knowledgeBaseIds.map((kbId) => ({ orgId: actor.orgId, knowledgeBaseId: kbId })) },
        tools: { create: data.tools.map((t) => ({ orgId: actor.orgId, toolId: t.toolId, effect: t.effect })) },
        workflows: { create: data.workflowIds.map((workflowId) => ({ workflowId })) },
      },
    });
    return agent;
  });

  await writeAudit({
    orgId: actor.orgId,
    actorType: actor.type,
    actorUserId: actor.userId,
    action: "agent.create",
    entityType: "Agent",
    entityId: agent.id,
    metadata: { name: agent.name, jobTitle: agent.jobTitle, templateKey: data.templateKey, tools: data.tools },
  });
  await recordActivity({
    orgId: actor.orgId,
    category: "AGENT",
    actorType: actor.type === "API_KEY" ? "API_KEY" : "USER",
    actorUserId: actor.userId,
    actorAgentId: agent.id,
    summary: `${agent.name} joined as ${agent.jobTitle}.`,
    entityType: "Agent",
    entityId: agent.id,
    link: `/agents/${agent.id}`,
  });
  return agent;
}

/** Builds a draft agent from a template, mapping to whatever exists in this workspace. */
export async function templateToAgentInput(orgId: string, templateKey: string, overrides: Partial<CreateAgentInput> = {}): Promise<CreateAgentInput> {
  const template = getAgentTemplate(templateKey);
  if (!template) throw notFound("Template");
  await assertTemplateEnabled(templateKey);
  const [department, tools, kbs] = await Promise.all([
    prisma.department.findFirst({ where: { orgId, name: template.department, deletedAt: null } }),
    prisma.tool.findMany({ where: { orgId, key: { in: template.suggestedTools.map((t) => t.toolKey) }, deletedAt: null } }),
    prisma.knowledgeBase.findMany({ where: { orgId, name: { in: template.suggestedKnowledge }, deletedAt: null } }),
  ]);
  return {
    name: template.suggestedName,
    jobTitle: template.jobTitle,
    departmentId: department?.id ?? null,
    description: template.summary,
    avatarColor: template.color,
    mission: template.mission,
    responsibilities: template.responsibilities,
    goals: template.goals,
    kpis: template.kpis,
    personality: template.personality as CreateAgentInput["personality"],
    instructions: template.instructions as Partial<Record<InstructionKey, string>>,
    tools: template.suggestedTools
      .map((s) => ({ s, tool: tools.find((t) => t.key === s.toolKey) }))
      .filter((x) => x.tool)
      .map(({ s, tool }) => ({ toolId: tool!.id, effect: s.effect })),
    knowledgeBaseIds: kbs.map((k) => k.id),
    templateKey,
    ...overrides,
  };
}

export async function createAgentFromTemplate(actor: Actor, templateKey: string, overrides: Partial<CreateAgentInput> = {}) {
  return createAgent(actor, await templateToAgentInput(actor.orgId, templateKey, overrides));
}

// ── Updates ──────────────────────────────────────────────────────────────────

async function bumpDraft(tx: Prisma.TransactionClient, agentId: string) {
  const agent = await tx.agent.findUniqueOrThrow({ where: { id: agentId } });
  // Editing a published agent starts a new draft version; the published snapshot keeps running.
  if (agent.publishedVersion !== null && agent.draftVersion <= agent.publishedVersion) {
    await tx.agent.update({ where: { id: agentId }, data: { draftVersion: agent.publishedVersion + 1 } });
  }
}

/** Changes only the fields named in `input`; everything else about the employee is left exactly as it was. */
export async function updateAgentProfile(actor: Actor, agentId: string, input: Partial<CreateAgentInput>) {
  await getAgent(actor.orgId, agentId);
  const data = onlySent(createAgentSchema.partial().parse(input), input);
  const limits = data.limits && input.limits ? onlySent(data.limits, input.limits) : undefined;
  if (data.departmentId) await assertOwned(actor.orgId, { departmentId: data.departmentId, knowledgeBaseIds: [], tools: [], workflowIds: [] });
  await prisma.$transaction(async (tx) => {
    await tx.agent.update({
      where: { id: agentId },
      data: {
        name: data.name,
        jobTitle: data.jobTitle,
        departmentId: data.departmentId === undefined ? undefined : data.departmentId || null,
        description: data.description,
        avatarColor: data.avatarColor,
        mission: data.mission,
        responsibilities: data.responsibilities,
        goals: data.goals,
        kpis: data.kpis,
        priority: data.priority,
        personality: data.personality,
        personalityNotes: data.personalityNotes,
        ...limits,
      },
    });
    if (data.model) {
      await tx.agentProviderConfig.upsert({
        where: { agentId },
        create: { agentId, ...data.model, fallbackProvider: data.model.fallbackProvider ?? null, fallbackModel: data.model.fallbackModel ?? null },
        update: { ...data.model, fallbackProvider: data.model.fallbackProvider ?? null, fallbackModel: data.model.fallbackModel ?? null },
      });
    }
    await bumpDraft(tx, agentId);
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "agent.update", entityType: "Agent", entityId: agentId, metadata: input });
}

export async function setAgentInstructions(actor: Actor, agentId: string, instructions: Partial<Record<InstructionKey, string>>) {
  await getAgent(actor.orgId, agentId);
  await prisma.$transaction(async (tx) => {
    for (const [section, content] of Object.entries(instructions)) {
      const trimmed = (content ?? "").trim();
      if (!trimmed) {
        await tx.agentInstruction.deleteMany({ where: { agentId, section: section as InstructionSection } });
      } else {
        await tx.agentInstruction.upsert({
          where: { agentId_section: { agentId, section: section as InstructionSection } },
          create: { agentId, section: section as InstructionSection, content: trimmed },
          update: { content: trimmed },
        });
      }
    }
    await bumpDraft(tx, agentId);
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "agent.instructions.update", entityType: "Agent", entityId: agentId });
}

export async function setAgentTools(actor: Actor, agentId: string, tools: { toolId: string; effect: "ALLOW" | "REQUIRE_APPROVAL" | "DENY" }[]) {
  await getAgent(actor.orgId, agentId);
  await assertOwned(actor.orgId, { departmentId: null, knowledgeBaseIds: [], tools, workflowIds: [] });
  await prisma.$transaction(async (tx) => {
    await tx.agentTool.deleteMany({ where: { agentId, toolId: { notIn: tools.map((t) => t.toolId) } } });
    for (const t of tools) {
      await tx.agentTool.upsert({
        where: { agentId_toolId: { agentId, toolId: t.toolId } },
        create: { orgId: actor.orgId, agentId, toolId: t.toolId, effect: t.effect },
        update: { effect: t.effect },
      });
    }
    await bumpDraft(tx, agentId);
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "agent.permissions.update", entityType: "Agent", entityId: agentId, metadata: { tools } });
}

export async function setAgentKnowledge(actor: Actor, agentId: string, knowledgeBaseIds: string[]) {
  await getAgent(actor.orgId, agentId);
  await assertOwned(actor.orgId, { departmentId: null, knowledgeBaseIds, tools: [], workflowIds: [] });
  await prisma.$transaction(async (tx) => {
    await tx.knowledgeAssignment.deleteMany({ where: { agentId, knowledgeBaseId: { notIn: knowledgeBaseIds } } });
    for (const kbId of knowledgeBaseIds) {
      await tx.knowledgeAssignment.upsert({
        where: { knowledgeBaseId_agentId: { knowledgeBaseId: kbId, agentId } },
        create: { orgId: actor.orgId, agentId, knowledgeBaseId: kbId },
        update: {},
      });
    }
    await bumpDraft(tx, agentId);
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "agent.knowledge.update", entityType: "Agent", entityId: agentId, metadata: { knowledgeBaseIds } });
}

export async function setAgentDelegates(actor: Actor, agentId: string, delegateIds: string[]) {
  await getAgent(actor.orgId, agentId);
  const ids = [...new Set(delegateIds.filter((id) => id !== agentId))];
  const count = await prisma.agent.count({ where: { orgId: actor.orgId, id: { in: ids }, deletedAt: null } });
  if (count !== ids.length) throw new AppError("VALIDATION", "One or more selected employees don't exist.");
  await prisma.$transaction(async (tx) => {
    await tx.agentDelegation.deleteMany({ where: { delegatorId: agentId, delegateId: { notIn: ids } } });
    for (const delegateId of ids) {
      await tx.agentDelegation.upsert({
        where: { delegatorId_delegateId: { delegatorId: agentId, delegateId } },
        create: { orgId: actor.orgId, delegatorId: agentId, delegateId },
        update: {},
      });
    }
    await tx.agent.update({ where: { id: agentId }, data: { canDelegate: ids.length > 0 } });
    await bumpDraft(tx, agentId);
  });
}

// ── Validation & publishing ──────────────────────────────────────────────────

export interface ValidationIssue {
  level: "error" | "warning";
  area: "role" | "instructions" | "model" | "knowledge" | "tools" | "permissions" | "approvals";
  message: string;
  fixHref?: string;
  fixLabel?: string;
}

/** Human-readable readiness checks before publishing (spec §113). */
export async function validateAgent(orgId: string, agentId: string): Promise<ValidationIssue[]> {
  const agent = await getAgent(orgId, agentId);
  const issues: ValidationIssue[] = [];
  const base = `/agents/${agentId}?tab=settings`;
  if (!agent.jobTitle.trim() || (!agent.mission && agent.responsibilities.length === 0)) {
    issues.push({ level: "error", area: "role", message: `${agent.name} needs a mission or at least one responsibility.`, fixHref: base, fixLabel: "Define role" });
  }
  if (agent.instructions.length === 0) {
    issues.push({ level: "error", area: "instructions", message: `${agent.name} has no instructions yet.`, fixHref: `${base}&section=instructions`, fixLabel: "Add instructions" });
  }
  const pc = agent.providerConfig;
  if (!pc) {
    issues.push({ level: "error", area: "model", message: "No AI model is selected.", fixHref: `${base}&section=model`, fixLabel: "Choose model" });
  } else {
    if (isOpenModelProvider(pc.provider) ? !pc.model.trim() : !getModel(pc.model)) {
      issues.push({ level: "error", area: "model", message: `The model "${pc.model}" isn't recognised.`, fixHref: `${base}&section=model`, fixLabel: "Choose model" });
    }
    const creds = await resolveProviderCredentials(orgId, pc.provider);
    if (pc.provider !== "OFFLINE" && creds.source === "none") {
      issues.push({
        level: "error",
        area: "model",
        message: `${agent.name} uses ${PROVIDER_LABELS[pc.provider]} but no API key is configured for it.`,
        fixHref: "/settings/providers",
        fixLabel: "Add API key",
      });
    }
    if (pc.provider === "OFFLINE") {
      issues.push({
        level: "warning",
        area: "model",
        message: `${agent.name} uses the offline demo model. It follows simple rules and is not real AI — connect an AI provider for real work.`,
        fixHref: "/settings/providers",
        fixLabel: "Connect provider",
      });
    }
  }
  for (const k of agent.knowledge) {
    if (k.knowledgeBase.deletedAt) issues.push({ level: "error", area: "knowledge", message: `Knowledge collection "${k.knowledgeBase.name}" was deleted.` });
  }
  const hasKnowledge = agent.knowledge.length > 0 || (agent.departmentId ? await prisma.knowledgeAssignment.count({ where: { departmentId: agent.departmentId } }) : 0) > 0;
  if (!hasKnowledge) {
    issues.push({ level: "warning", area: "knowledge", message: `${agent.name} has no company knowledge yet.`, fixHref: `/agents/${agentId}?tab=knowledge`, fixLabel: "Add knowledge" });
  }
  for (const t of agent.tools) {
    if (t.tool.deletedAt || !t.tool.enabled) {
      issues.push({ level: "error", area: "tools", message: `Tool "${t.tool.name}" is disabled or removed.`, fixHref: `/agents/${agentId}?tab=tools`, fixLabel: "Review tools" });
    } else if (t.tool.connectionId) {
      const conn = await prisma.integrationConnection.findUnique({ where: { id: t.tool.connectionId } });
      if (!conn || conn.status !== "CONNECTED") {
        issues.push({
          level: "error",
          area: "tools",
          message: `${agent.name} uses ${t.tool.name}, but its integration isn't connected.`,
          fixHref: "/integrations",
          fixLabel: "Connect integration",
        });
      }
    }
    if ((t.tool.riskLevel === "HIGH" || t.tool.riskLevel === "CRITICAL") && t.effect === "ALLOW") {
      issues.push({
        level: "warning",
        area: "permissions",
        message: `${t.tool.name} is ${t.tool.riskLevel.toLowerCase()} risk and allowed without approval. Company approval rules may still pause it.`,
        fixHref: `/agents/${agentId}?tab=tools`,
        fixLabel: "Review permission",
      });
    }
  }
  return issues;
}

export async function buildSnapshot(orgId: string, agentId: string, version: number): Promise<AgentSnapshot> {
  const agent = await getAgent(orgId, agentId);
  const pc = agent.providerConfig;
  return {
    schema: 1,
    version,
    name: agent.name,
    jobTitle: agent.jobTitle,
    departmentId: agent.departmentId,
    departmentName: agent.department?.name ?? null,
    description: agent.description,
    mission: agent.mission,
    responsibilities: agent.responsibilities,
    goals: agent.goals,
    kpis: agent.kpis,
    personality: agent.personality,
    personalityNotes: agent.personalityNotes,
    instructions: Object.fromEntries(agent.instructions.map((i) => [i.section, i.content])),
    model: {
      provider: pc?.provider ?? "OFFLINE",
      model: pc?.model ?? "offline-demo",
      fallbackProvider: pc?.fallbackProvider ?? null,
      fallbackModel: pc?.fallbackModel ?? null,
      temperature: pc?.temperature ?? 0.3,
      maxOutputTokens: pc?.maxOutputTokens ?? 4000,
    },
    limits: {
      maxStepsPerRun: agent.maxStepsPerRun,
      maxToolCallsPerRun: agent.maxToolCallsPerRun,
      maxTokensPerRun: agent.maxTokensPerRun,
      maxCostPerRunUsd: agent.maxCostPerRunUsd,
      monthlyBudgetUsd: agent.monthlyBudgetUsd,
    },
    canDelegate: agent.canDelegate,
    delegateIds: agent.delegatesTo.map((d) => d.delegateId),
    knowledgeBaseIds: agent.knowledge.map((k) => k.knowledgeBaseId),
    tools: agent.tools.filter((t) => !t.tool.deletedAt).map((t) => ({ toolId: t.toolId, key: t.tool.key, effect: t.effect })),
    workflowIds: agent.workflows.map((w) => w.workflowId),
  };
}

export async function publishAgent(actor: Actor, agentId: string, notes?: string) {
  const issues = await validateAgent(actor.orgId, agentId);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) {
    throw new AppError("VALIDATION", errors.map((e) => e.message).join(" "), { details: { issues } });
  }
  const agent = await getAgent(actor.orgId, agentId);
  const version = agent.publishedVersion === null ? Math.max(1, agent.draftVersion) : Math.max(agent.draftVersion, agent.publishedVersion + 1);
  const snapshot = await buildSnapshot(actor.orgId, agentId, version);
  await prisma.$transaction([
    prisma.agentVersion.updateMany({ where: { agentId, status: "PUBLISHED" }, data: { status: "SUPERSEDED" } }),
    prisma.agentVersion.create({
      data: {
        orgId: actor.orgId,
        agentId,
        version,
        status: "PUBLISHED",
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        notes: notes || null,
        publishedById: actor.userId ?? null,
      },
    }),
    prisma.agent.update({ where: { id: agentId }, data: { lifecycle: "PUBLISHED", publishedVersion: version, draftVersion: version } }),
  ]);
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "agent.publish", entityType: "Agent", entityId: agentId, metadata: { version } });
  await recordActivity({
    orgId: actor.orgId,
    category: "AGENT",
    actorType: "USER",
    actorUserId: actor.userId,
    actorAgentId: agentId,
    summary: `${agent.name} v${version} was published.`,
    entityType: "Agent",
    entityId: agentId,
    link: `/agents/${agentId}`,
  });
  return { version, warnings: issues.filter((i) => i.level === "warning") };
}

/**
 * The snapshot a run should use: the published version, or — for draft agents
 * and simulations — the live draft configuration.
 */
export async function resolveRunSnapshot(orgId: string, agentId: string, opts: { useDraft?: boolean } = {}): Promise<AgentSnapshot> {
  const agent = await getAgent(orgId, agentId);
  if (!opts.useDraft && agent.publishedVersion !== null) {
    const v = await prisma.agentVersion.findUnique({ where: { agentId_version: { agentId, version: agent.publishedVersion } } });
    if (v) return v.snapshot as unknown as AgentSnapshot;
  }
  return buildSnapshot(orgId, agentId, agent.draftVersion);
}

export async function setAgentStatus(actor: Actor, agentId: string, status: AgentStatus, statusMessage?: string | null) {
  const agent = await getAgent(actor.orgId, agentId);
  await prisma.agent.update({ where: { id: agentId }, data: { status, statusMessage: statusMessage ?? null } });
  if (status === "PAUSED" || (agent.status === "PAUSED" && status === "ACTIVE")) {
    await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: status === "PAUSED" ? "agent.pause" : "agent.resume", entityType: "Agent", entityId: agentId });
    await recordActivity({
      orgId: actor.orgId,
      category: "AGENT",
      actorType: "USER",
      actorUserId: actor.userId,
      actorAgentId: agentId,
      summary: status === "PAUSED" ? `${agent.name} was paused.` : `${agent.name} is back at work.`,
      entityType: "Agent",
      entityId: agentId,
      link: `/agents/${agentId}`,
    });
  }
}

export async function duplicateAgent(actor: Actor, agentId: string) {
  const agent = await getAgent(actor.orgId, agentId);
  const pc = agent.providerConfig;
  return createAgent(actor, {
    name: `${agent.name} (copy)`.slice(0, 60),
    jobTitle: agent.jobTitle,
    departmentId: agent.departmentId,
    description: agent.description ?? "",
    avatarColor: agent.avatarColor,
    mission: agent.mission ?? "",
    responsibilities: agent.responsibilities,
    goals: agent.goals,
    kpis: agent.kpis,
    priority: agent.priority,
    personality: agent.personality as CreateAgentInput["personality"],
    personalityNotes: agent.personalityNotes ?? "",
    instructions: Object.fromEntries(agent.instructions.map((i) => [i.section, i.content])),
    model: pc
      ? { provider: pc.provider, model: pc.model, fallbackProvider: pc.fallbackProvider, fallbackModel: pc.fallbackModel, temperature: pc.temperature, maxOutputTokens: pc.maxOutputTokens }
      : undefined,
    knowledgeBaseIds: agent.knowledge.map((k) => k.knowledgeBaseId),
    tools: agent.tools.map((t) => ({ toolId: t.toolId, effect: t.effect })),
    workflowIds: agent.workflows.map((w) => w.workflowId),
    limits: {
      maxStepsPerRun: agent.maxStepsPerRun,
      maxToolCallsPerRun: agent.maxToolCallsPerRun,
      maxTokensPerRun: agent.maxTokensPerRun,
      maxCostPerRunUsd: agent.maxCostPerRunUsd,
      monthlyBudgetUsd: agent.monthlyBudgetUsd,
    },
  });
}

/** Soft-deletes the agent; history (runs, audit) is retained. */
export async function archiveAgent(actor: Actor, agentId: string) {
  const agent = await getAgent(actor.orgId, agentId);
  await prisma.agent.update({ where: { id: agentId }, data: { deletedAt: new Date(), lifecycle: "ARCHIVED", status: "PAUSED" } });
  await prisma.schedule.updateMany({ where: { agentId }, data: { enabled: false } });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "agent.delete", entityType: "Agent", entityId: agentId });
  await recordActivity({
    orgId: actor.orgId,
    category: "AGENT",
    actorType: "USER",
    actorUserId: actor.userId,
    summary: `${agent.name} was removed from the workforce.`,
    entityType: "Agent",
    entityId: agentId,
  });
}
