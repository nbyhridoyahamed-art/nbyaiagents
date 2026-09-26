import { prisma } from "@/lib/db";
import type { AgentLifecycle, AgentStatus, RunStatus, WorkflowStatus } from "@/lib/generated/prisma/enums";

/**
 * AI Office (spec §103, Phase 13): a visual map of the workforce — departments as
 * rooms, employees, what they're doing, who delegates to whom and which workflows
 * connect them. Everything is read from real records.
 */

const ACTIVE: RunStatus[] = ["QUEUED", "RUNNING", "WAITING", "AWAITING_APPROVAL"];
const RECENT_DAYS = 30;

export interface OfficeRoom {
  id: string;
  name: string;
  color: string;
  icon: string;
  agentIds: string[];
}

export interface OfficeAgent {
  id: string;
  name: string;
  jobTitle: string;
  color: string;
  status: AgentStatus;
  lifecycle: AgentLifecycle;
  activity: string | null;
  progress: number | null;
  departmentId: string | null;
  activeRuns: number;
}

export interface OfficeWorkflow {
  id: string;
  name: string;
  status: WorkflowStatus;
  agentIds: string[];
  activeRuns: number;
  runs30d: number;
}

export interface OfficeDelegation {
  id: string;
  from: string;
  to: string;
  activeRuns: number;
  recentRuns: number;
}

export interface OfficeData {
  rooms: OfficeRoom[];
  agents: OfficeAgent[];
  workflows: OfficeWorkflow[];
  delegations: OfficeDelegation[];
}

export const UNASSIGNED_ROOM = "unassigned";

/** Agent IDs referenced by a workflow version's steps (employee steps and "act as" tool steps). */
function agentIdsFromNodes(nodes: { config: unknown }[]): string[] {
  const ids = new Set<string>();
  for (const n of nodes) {
    const id = (n.config as { agentId?: unknown } | null)?.agentId;
    if (typeof id === "string" && id) ids.add(id);
  }
  return [...ids];
}

export async function getOfficeData(orgId: string): Promise<OfficeData> {
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
  const [departments, agents, runningTasks, activeRunGroups, workflows, delegations, childRuns] = await Promise.all([
    prisma.department.findMany({ where: { orgId, deletedAt: null }, orderBy: { name: "asc" } }),
    prisma.agent.findMany({ where: { orgId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
    prisma.task.findMany({
      where: { orgId, deletedAt: null, status: { in: ["RUNNING", "AWAITING_APPROVAL", "WAITING"] }, agentId: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: { agentId: true, title: true, progress: true },
    }),
    prisma.agentRun.groupBy({ by: ["agentId"], where: { orgId, status: { in: ACTIVE } }, _count: true }),
    prisma.workflow.findMany({
      where: { orgId, deletedAt: null, status: { not: "ARCHIVED" } },
      include: { agents: { select: { agentId: true } }, versions: { orderBy: { version: "desc" }, select: { id: true, status: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.agentDelegation.findMany({ where: { orgId } }),
    prisma.agentRun.findMany({ where: { orgId, parentRunId: { not: null }, createdAt: { gte: since } }, select: { agentId: true, parentRunId: true, status: true } }),
  ]);

  // Which employees each workflow involves: explicit links + the steps of its current version.
  const versionIds = workflows.map((w) => (w.versions.find((v) => v.status === "PUBLISHED") ?? w.versions[0])?.id).filter((v): v is string => !!v);
  const [nodes, wfRunGroups, wfRecent] = await Promise.all([
    versionIds.length ? prisma.workflowNode.findMany({ where: { versionId: { in: versionIds } }, select: { versionId: true, config: true } }) : [],
    prisma.workflowRun.groupBy({ by: ["workflowId"], where: { orgId, status: { in: ACTIVE }, mode: "LIVE" }, _count: true }),
    prisma.workflowRun.groupBy({ by: ["workflowId"], where: { orgId, mode: "LIVE", createdAt: { gte: since } }, _count: true }),
  ]);
  const agentIdSet = new Set(agents.map((a) => a.id));

  const officeAgents: OfficeAgent[] = agents.map((a) => {
    const current = runningTasks.find((t) => t.agentId === a.id);
    return {
      id: a.id,
      name: a.name,
      jobTitle: a.jobTitle,
      color: a.avatarColor,
      status: a.status,
      lifecycle: a.lifecycle,
      activity: current?.title ?? a.statusMessage ?? null,
      progress: current ? current.progress : null,
      departmentId: a.departmentId && departments.some((d) => d.id === a.departmentId) ? a.departmentId : null,
      activeRuns: activeRunGroups.find((g) => g.agentId === a.id)?._count ?? 0,
    };
  });

  const rooms: OfficeRoom[] = departments
    .map((d) => ({ id: d.id, name: d.name, color: d.color, icon: d.icon, agentIds: officeAgents.filter((a) => a.departmentId === d.id).map((a) => a.id) }))
    .filter((r) => r.agentIds.length > 0);
  const unassigned = officeAgents.filter((a) => !a.departmentId).map((a) => a.id);
  if (unassigned.length) rooms.push({ id: UNASSIGNED_ROOM, name: "No department", color: "#667085", icon: "users", agentIds: unassigned });

  const officeWorkflows: OfficeWorkflow[] = workflows.map((w) => {
    const version = w.versions.find((v) => v.status === "PUBLISHED") ?? w.versions[0];
    const ids = new Set([...w.agents.map((x) => x.agentId), ...agentIdsFromNodes(nodes.filter((n) => n.versionId === version?.id))]);
    return {
      id: w.id,
      name: w.name,
      status: w.status,
      agentIds: [...ids].filter((id) => agentIdSet.has(id)),
      activeRuns: wfRunGroups.find((g) => g.workflowId === w.id)?._count ?? 0,
      runs30d: wfRecent.find((g) => g.workflowId === w.id)?._count ?? 0,
    };
  });

  // Delegation activity: child runs whose parent run belonged to the delegator.
  const parentIds = [...new Set(childRuns.map((r) => r.parentRunId!))];
  const parents = parentIds.length ? await prisma.agentRun.findMany({ where: { id: { in: parentIds } }, select: { id: true, agentId: true } }) : [];
  const officeDelegations: OfficeDelegation[] = delegations
    .filter((d) => agentIdSet.has(d.delegatorId) && agentIdSet.has(d.delegateId))
    .map((d) => {
      const runs = childRuns.filter((r) => r.agentId === d.delegateId && parents.find((p) => p.id === r.parentRunId)?.agentId === d.delegatorId);
      return { id: d.id, from: d.delegatorId, to: d.delegateId, recentRuns: runs.length, activeRuns: runs.filter((r) => ACTIVE.includes(r.status)).length };
    });

  return { rooms, agents: officeAgents, workflows: officeWorkflows, delegations: officeDelegations };
}
