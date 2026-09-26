import { prisma } from "@/lib/db";
import type { AgentStatus, ApprovalKind, RunStatus } from "@/lib/generated/prisma/enums";
import { getIntegration } from "@/lib/integrations/catalog";
import { startOfDayInTimeZone, startOfMonthInTimeZone } from "@/lib/time";
import { listAgentCards } from "@/server/services/agent-queries";

/**
 * Dashboard data (spec §62–106). Every number here is measured from the
 * database — nothing is estimated or invented. Each section has its own loader
 * so one failing query never takes down the whole dashboard.
 */

const ACTIVE_TASK = ["QUEUED", "RUNNING", "WAITING", "AWAITING_APPROVAL"] as const;
const ACTIVE_RUN: RunStatus[] = ["RUNNING", "WAITING", "AWAITING_APPROVAL"];

export interface DashboardSummary {
  agents: { total: number; working: number; scheduled: number; awaiting: number; byStatus: Partial<Record<AgentStatus, number>> };
  departments: string[];
  tasks: { running: number; startedToday: number; completedToday: number; failedToday: number; successRateToday: number | null };
  attention: { approvals: number; questions: number; integrations: number; total: number };
}

export async function getDashboardSummary(orgId: string, timeZone: string): Promise<DashboardSummary> {
  const today = startOfDayInTimeZone(timeZone);
  const [agentGroups, depts, running, startedToday, finishedToday, approvalGroups, brokenConnections] = await Promise.all([
    prisma.agent.groupBy({ by: ["status"], where: { orgId, deletedAt: null }, _count: true }),
    prisma.department.findMany({ where: { orgId, deletedAt: null, agents: { some: { deletedAt: null } } }, select: { name: true }, orderBy: { name: "asc" } }),
    prisma.task.count({ where: { orgId, deletedAt: null, status: { in: [...ACTIVE_TASK] } } }),
    prisma.task.count({ where: { orgId, deletedAt: null, startedAt: { gte: today } } }),
    prisma.task.groupBy({ by: ["status"], where: { orgId, deletedAt: null, completedAt: { gte: today }, status: { in: ["COMPLETED", "FAILED"] } }, _count: true }),
    prisma.approval.groupBy({ by: ["kind"], where: { orgId, status: "PENDING" }, _count: true }),
    prisma.integrationConnection.count({ where: { orgId, status: { in: ["ERROR", "NEEDS_REAUTH"] } } }),
  ]);
  const byStatus = Object.fromEntries(agentGroups.map((g) => [g.status, g._count])) as Partial<Record<AgentStatus, number>>;
  const total = agentGroups.reduce((s, g) => s + g._count, 0);
  const completed = finishedToday.find((g) => g.status === "COMPLETED")?._count ?? 0;
  const failed = finishedToday.find((g) => g.status === "FAILED")?._count ?? 0;
  const kindCount = (kinds: ApprovalKind[]) => approvalGroups.filter((g) => kinds.includes(g.kind)).reduce((s, g) => s + g._count, 0);
  const approvals = kindCount(["TOOL_ACTION", "REVIEW"]);
  const questions = kindCount(["QUESTION", "INPUT_REQUEST", "ESCALATION"]);
  return {
    agents: {
      total,
      working: byStatus.WORKING ?? 0,
      scheduled: byStatus.SCHEDULED ?? 0,
      awaiting: (byStatus.APPROVAL ?? 0) + (byStatus.WAITING ?? 0),
      byStatus,
    },
    departments: depts.map((d) => d.name),
    tasks: {
      running,
      startedToday,
      completedToday: completed,
      failedToday: failed,
      successRateToday: completed + failed > 0 ? Math.round((completed / (completed + failed)) * 100) : null,
    },
    attention: { approvals, questions, integrations: brokenConnections, total: approvals + questions + brokenConnections },
  };
}

const STATUS_ORDER: AgentStatus[] = ["WORKING", "APPROVAL", "WAITING", "ERROR", "ACTIVE", "SCHEDULED", "PAUSED"];

/** The workforce centerpiece: busiest employees first. */
export async function getWorkforce(orgId: string, limit = 8) {
  const cards = await listAgentCards(orgId);
  const sorted = [...cards].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  return { agents: sorted.slice(0, limit), total: cards.length };
}

export interface AttentionItem {
  id: string;
  kind: "approval" | "review" | "question" | "input" | "escalation" | "integration";
  label: string;
  who: { name: string; color: string | null };
  title: string;
  at: string;
  href: string;
}

const KIND_LABEL: Record<ApprovalKind, { kind: AttentionItem["kind"]; label: string }> = {
  TOOL_ACTION: { kind: "approval", label: "Approval" },
  REVIEW: { kind: "review", label: "Review" },
  QUESTION: { kind: "question", label: "Question" },
  INPUT_REQUEST: { kind: "input", label: "Input needed" },
  ESCALATION: { kind: "escalation", label: "Escalation" },
};

export async function getAttention(orgId: string, limit = 6): Promise<AttentionItem[]> {
  const [approvals, connections] = await Promise.all([
    prisma.approval.findMany({
      where: { orgId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { agent: { select: { name: true, avatarColor: true } } },
    }),
    prisma.integrationConnection.findMany({ where: { orgId, status: { in: ["ERROR", "NEEDS_REAUTH"] } }, orderBy: { updatedAt: "desc" }, take: 3 }),
  ]);
  const items: AttentionItem[] = approvals.map((a) => {
    const meta = KIND_LABEL[a.kind];
    const isAction = a.kind === "TOOL_ACTION" || a.kind === "REVIEW";
    return {
      id: a.id,
      kind: meta.kind,
      label: meta.label,
      who: { name: a.agent?.name ?? "Workflow", color: a.agent?.avatarColor ?? null },
      title: a.title,
      at: a.createdAt.toISOString(),
      href: isAction ? `/approvals?focus=${a.id}` : "/inbox",
    };
  });
  for (const c of connections) {
    items.push({
      id: c.id,
      kind: "integration",
      label: "Integration",
      who: { name: getIntegration(c.integrationKey)?.name ?? c.name, color: null },
      title: c.status === "NEEDS_REAUTH" ? "Connection needs reauthorization" : (c.lastError ?? "Connection has an error"),
      at: c.updatedAt.toISOString(),
      href: "/integrations",
    });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export interface LiveRun {
  id: string;
  status: RunStatus;
  mode: "LIVE" | "SIMULATION";
  agent: { id: string; name: string; jobTitle: string; color: string; status: AgentStatus };
  title: string;
  taskId: string | null;
  progress: number | null;
  steps: { id: string; label: string; status: string }[];
  startedAt: string | null;
}

/** Executions happening right now, with their operational steps (never model reasoning). */
export async function getLiveWork(orgId: string, limit = 2): Promise<{ runs: LiveRun[]; activeRuns: number; activeWorkflowRuns: number }> {
  const [runs, activeRuns, activeWorkflowRuns] = await Promise.all([
    prisma.agentRun.findMany({
      where: { orgId, status: { in: ACTIVE_RUN } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: {
        agent: { select: { id: true, name: true, jobTitle: true, avatarColor: true, status: true } },
        steps: { where: { type: { not: "CONTEXT" } }, orderBy: { sequence: "asc" }, select: { id: true, label: true, status: true } },
      },
    }),
    prisma.agentRun.count({ where: { orgId, status: { in: ACTIVE_RUN } } }),
    prisma.workflowRun.count({ where: { orgId, status: { in: ["QUEUED", ...ACTIVE_RUN] } } }),
  ]);
  const taskIds = runs.map((r) => r.taskId).filter((t): t is string => !!t);
  const tasks = taskIds.length ? await prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, title: true, progress: true } }) : [];
  return {
    runs: runs.map((r) => {
      const task = tasks.find((t) => t.id === r.taskId);
      return {
        id: r.id,
        status: r.status,
        mode: r.mode,
        agent: { id: r.agent.id, name: r.agent.name, jobTitle: r.agent.jobTitle, color: r.agent.avatarColor, status: r.agent.status },
        title: task?.title ?? (r.input ? r.input.split("\n")[0].slice(0, 120) : "Working"),
        taskId: r.taskId,
        progress: task ? task.progress : null,
        steps: r.steps.slice(-8),
        startedAt: r.startedAt?.toISOString() ?? null,
      };
    }),
    activeRuns,
    activeWorkflowRuns,
  };
}

export interface CompanyHealth {
  employees: { healthy: number; total: number };
  workflows: { active: number; total: number };
  integrations: { connected: number; total: number };
  knowledge: { indexed: number; total: number; percent: number | null };
  usage: { spentUsd: number; budgetUsd: number; percent: number };
}

export async function getCompanyHealth(orgId: string, timeZone: string, budgetUsd: number): Promise<CompanyHealth> {
  const month = startOfMonthInTimeZone(timeZone);
  const [agents, agentErrors, workflowGroups, connections, docGroups, spend] = await Promise.all([
    prisma.agent.count({ where: { orgId, deletedAt: null } }),
    prisma.agent.count({ where: { orgId, deletedAt: null, status: "ERROR" } }),
    prisma.workflow.groupBy({ by: ["status"], where: { orgId, deletedAt: null, status: { not: "ARCHIVED" }, publishedVersion: { not: null } }, _count: true }),
    prisma.integrationConnection.groupBy({ by: ["status"], where: { orgId, status: { not: "DISCONNECTED" } }, _count: true }),
    prisma.knowledgeDocument.groupBy({ by: ["status"], where: { orgId, deletedAt: null }, _count: true }),
    prisma.usageRecord.aggregate({ where: { orgId, kind: "AI_TOKENS", createdAt: { gte: month } }, _sum: { costUsd: true } }),
  ]);
  const sum = (g: { _count: number }[]) => g.reduce((s, x) => s + x._count, 0);
  const docsTotal = sum(docGroups);
  const indexed = docGroups.find((g) => g.status === "INDEXED")?._count ?? 0;
  const spent = Math.round((spend._sum.costUsd ?? 0) * 100) / 100;
  return {
    employees: { healthy: agents - agentErrors, total: agents },
    workflows: { active: workflowGroups.find((g) => g.status === "ACTIVE")?._count ?? 0, total: sum(workflowGroups) },
    integrations: { connected: connections.find((g) => g.status === "CONNECTED")?._count ?? 0, total: sum(connections) },
    knowledge: { indexed, total: docsTotal, percent: docsTotal ? Math.round((indexed / docsTotal) * 100) : null },
    usage: { spentUsd: spent, budgetUsd: budgetUsd, percent: budgetUsd > 0 ? Math.min(100, Math.round((spent / budgetUsd) * 100)) : 0 },
  };
}

export interface WorkflowPerformanceRow {
  id: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
  agent: { name: string; color: string } | null;
  runs: number;
  successRate: number | null;
  lastRunAt: string | null;
}

/** Live (non-simulation) run statistics per workflow. */
export async function getWorkflowPerformance(orgId: string, limit = 8): Promise<WorkflowPerformanceRow[]> {
  const workflows = await prisma.workflow.findMany({
    where: { orgId, deletedAt: null, status: { not: "ARCHIVED" } },
    include: { agents: { include: { agent: { select: { name: true, avatarColor: true, deletedAt: true } } }, orderBy: { createdAt: "asc" } } },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  if (!workflows.length) return [];
  const ids = workflows.map((w) => w.id);
  const [groups, last] = await Promise.all([
    prisma.workflowRun.groupBy({ by: ["workflowId", "status"], where: { orgId, workflowId: { in: ids }, mode: "LIVE" }, _count: true }),
    prisma.workflowRun.groupBy({ by: ["workflowId"], where: { orgId, workflowId: { in: ids }, mode: "LIVE" }, _max: { createdAt: true } }),
  ]);
  const rows = workflows.map((w) => {
    const mine = groups.filter((g) => g.workflowId === w.id);
    const runs = mine.reduce((s, g) => s + g._count, 0);
    const ok = mine.find((g) => g.status === "COMPLETED")?._count ?? 0;
    const bad = mine.find((g) => g.status === "FAILED")?._count ?? 0;
    const agent = w.agents.find((a) => !a.agent.deletedAt)?.agent;
    return {
      id: w.id,
      name: w.name,
      status: w.status,
      agent: agent ? { name: agent.name, color: agent.avatarColor } : null,
      runs,
      successRate: ok + bad > 0 ? Math.round((ok / (ok + bad)) * 100) : null,
      lastRunAt: last.find((l) => l.workflowId === w.id)?._max.createdAt?.toISOString() ?? null,
    };
  });
  // Busiest first, then most recently run.
  return rows.sort((a, b) => b.runs - a.runs || (b.lastRunAt ?? "").localeCompare(a.lastRunAt ?? "")).slice(0, limit);
}

export interface ActivityItem {
  id: string;
  summary: string;
  detail: string | null;
  category: string;
  at: string;
  link: string | null;
  isSimulation: boolean;
  agent: { name: string; color: string } | null;
}

export async function getRecentActivity(orgId: string, limit = 8): Promise<ActivityItem[]> {
  const rows = await prisma.activityLog.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: limit });
  const agentIds = [...new Set(rows.map((r) => r.actorAgentId).filter((a): a is string => !!a))];
  const agents = agentIds.length ? await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true, avatarColor: true } }) : [];
  return rows.map((r) => {
    const a = agents.find((x) => x.id === r.actorAgentId);
    return {
      id: r.id,
      summary: r.summary,
      detail: r.detail,
      category: r.category,
      at: r.createdAt.toISOString(),
      link: r.link,
      isSimulation: r.isSimulation,
      agent: a ? { name: a.name, color: a.avatarColor } : null,
    };
  });
}

export async function getSetupState(orgId: string) {
  const [agents, workflows, docs] = await Promise.all([
    prisma.agent.count({ where: { orgId, deletedAt: null } }),
    prisma.workflow.count({ where: { orgId, deletedAt: null, status: { not: "ARCHIVED" } } }),
    prisma.knowledgeDocument.count({ where: { orgId, deletedAt: null } }),
  ]);
  return { agents, workflows, docs };
}
