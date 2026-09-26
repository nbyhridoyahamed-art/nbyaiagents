import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/auth/actor";
import { AGENT_TEMPLATES } from "@/lib/templates/agents";
import { getWorkflowTemplate, WORKFLOW_TEMPLATES } from "@/lib/templates/workflows";
import { getIntegration } from "@/lib/integrations/catalog";
import { createAgentFromTemplate } from "@/server/services/agents";
import { createWorkflow } from "@/server/services/workflows";
import { recordActivity, writeAudit } from "@/server/services/audit";
import { assertTemplateEnabled } from "@/server/services/platform-settings";

/**
 * Template installation (spec §59–60, Phase 15). Installing always creates drafts:
 * employees and workflows must still be reviewed, tested and published by a person.
 */

export interface TemplateUsage {
  count: number;
  /** Items installed from an older version of the template. */
  outdated: number;
  items: { id: string; name: string; version: number | null }[];
}

export async function getTemplateUsage(orgId: string) {
  const [agents, workflows] = await Promise.all([
    prisma.agent.findMany({ where: { orgId, deletedAt: null, templateKey: { not: null } }, select: { id: true, name: true, templateKey: true, templateVersion: true } }),
    prisma.workflow.findMany({ where: { orgId, deletedAt: null, templateKey: { not: null } }, select: { id: true, name: true, templateKey: true, templateVersion: true } }),
  ]);
  const usage = (rows: { id: string; name: string; templateKey: string | null; templateVersion: number | null }[], key: string, version: number): TemplateUsage => {
    const mine = rows.filter((r) => r.templateKey === key);
    return { count: mine.length, outdated: mine.filter((r) => (r.templateVersion ?? 0) < version).length, items: mine.map((r) => ({ id: r.id, name: r.name, version: r.templateVersion })) };
  };
  return {
    agents: Object.fromEntries(AGENT_TEMPLATES.map((t) => [t.key, usage(agents, t.key, t.version)])) as Record<string, TemplateUsage>,
    workflows: Object.fromEntries(WORKFLOW_TEMPLATES.map((t) => [t.key, usage(workflows, t.key, t.version)])) as Record<string, TemplateUsage>,
  };
}

export const HIRE_NEW = "hire";

export interface InstallResult {
  workflowId: string;
  hired: { role: string; agentId: string; name: string }[];
  notes: string[];
}

/** Checks a template against the org before (or after) installing: integrations and approval expectations. */
export async function templateReadiness(orgId: string, key: string, roles: Record<string, string>) {
  const t = getWorkflowTemplate(key);
  if (!t) throw new AppError("NOT_FOUND", "Template not found.");
  const connections = await prisma.integrationConnection.findMany({ where: { orgId, integrationKey: { in: t.integrations } } });
  const notes: string[] = [];
  for (const i of t.integrations) {
    if (connections.find((c) => c.integrationKey === i)?.status !== "CONNECTED") notes.push(`Connect ${getIntegration(i)?.name ?? i} so the workflow's steps can run.`);
  }
  for (const e of t.expectsApproval) {
    const agentId = roles[e.role];
    if (!agentId || agentId === HIRE_NEW) continue;
    const agent = await prisma.agent.findFirst({ where: { id: agentId, orgId, deletedAt: null }, select: { name: true } });
    if (!agent) continue; // unknown or another company's employee: say nothing about it
    const grant = await prisma.agentTool.findFirst({ where: { agentId, tool: { orgId, key: e.toolKey, deletedAt: null } }, include: { agent: { select: { name: true } }, tool: { select: { name: true } } } });
    if (!grant) {
      notes.push(`${agent.name} doesn't have the tool “${e.toolKey}” yet — give it to them (with “Requires approval”) before running live.`);
    } else if (grant.effect === "ALLOW") {
      notes.push(`${grant.agent.name} can use “${grant.tool.name}” without approval. ${e.why} Consider changing it to “Requires approval”.`);
    } else if (grant.effect === "DENY") {
      notes.push(`${grant.agent.name} is blocked from “${grant.tool.name}”, so that step will fail until you allow it (with approval).`);
    }
  }
  return notes;
}

export async function installWorkflowTemplate(actor: Actor, key: string, input: { name?: string; roles: Record<string, string> }): Promise<InstallResult> {
  const t = getWorkflowTemplate(key);
  if (!t) throw new AppError("NOT_FOUND", "Template not found.");
  await assertTemplateEnabled(key);
  const chosen: Record<string, string> = {};
  const hired: InstallResult["hired"] = [];

  for (const role of t.roles) {
    const pick = input.roles[role.key];
    if (!pick) throw new AppError("VALIDATION", `Choose who handles “${role.label}”.`, { fieldErrors: { [`roles.${role.key}`]: "Choose an employee." } });
    if (pick === HIRE_NEW) {
      const agent = await createAgentFromTemplate(actor, role.agentTemplate);
      chosen[role.key] = agent.id;
      hired.push({ role: role.label, agentId: agent.id, name: agent.name });
    } else {
      const agent = await prisma.agent.findFirst({ where: { id: pick, orgId: actor.orgId, deletedAt: null } });
      if (!agent) throw new AppError("VALIDATION", "That employee doesn't exist.", { fieldErrors: { [`roles.${role.key}`]: "Choose an employee." } });
      chosen[role.key] = agent.id;
    }
  }

  const primary = t.roles.length === 1 ? chosen[t.roles[0].key] : null;
  const primaryAgent = primary ? await prisma.agent.findUnique({ where: { id: primary }, select: { departmentId: true } }) : null;
  const name = input.name?.trim() || t.name;
  const wf = await createWorkflow(actor, {
    name,
    description: t.summary,
    departmentId: primaryAgent?.departmentId ?? null,
    graph: t.build(chosen),
    settings: { defaultAgentId: primary },
    templateKey: t.key,
    templateVersion: t.version,
  });
  // Every involved employee is linked, so the workflow shows up on their profile and in the AI Office.
  for (const agentId of new Set(Object.values(chosen))) {
    await prisma.agentWorkflow.upsert({ where: { agentId_workflowId: { agentId, workflowId: wf.id } }, create: { agentId, workflowId: wf.id }, update: {} });
  }

  const notes = await templateReadiness(actor.orgId, key, chosen);
  if (hired.length) notes.unshift(`New draft employee${hired.length === 1 ? "" : "s"}: ${hired.map((h) => h.name).join(", ")}. Review and publish them before running this workflow live.`);

  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "template.install", entityType: "Workflow", entityId: wf.id, metadata: { templateKey: t.key, version: t.version, hired: hired.map((h) => h.agentId) } });
  await recordActivity({
    orgId: actor.orgId,
    category: "WORKFLOW",
    actorType: "USER",
    actorUserId: actor.userId,
    summary: `The “${t.name}” template was installed as a draft workflow.`,
    entityType: "Workflow",
    entityId: wf.id,
    link: `/workflows/${wf.id}`,
  });
  return { workflowId: wf.id, hired, notes };
}
