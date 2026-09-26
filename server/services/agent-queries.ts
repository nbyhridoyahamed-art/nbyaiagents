import { prisma } from "@/lib/db";
import { getIntegration } from "@/lib/integrations/catalog";
import type { AgentLifecycle, AgentStatus } from "@/lib/generated/prisma/enums";

export interface AgentCardData {
  id: string;
  name: string;
  jobTitle: string;
  department: string | null;
  color: string;
  status: AgentStatus;
  lifecycle: AgentLifecycle;
  activity: string | null;
  progress: number | null;
  tools: string[];
  tasksCompleted: number;
  successRate: number | null;
  isOfflineModel: boolean;
}

/**
 * Card data for the workforce grid. All numbers are measured from tasks and runs;
 * success rate is null when there is no finished work yet (never invented).
 */
export async function listAgentCards(orgId: string, filter: { departmentId?: string; status?: AgentStatus; q?: string } = {}): Promise<AgentCardData[]> {
  const agents = await prisma.agent.findMany({
    where: {
      orgId,
      deletedAt: null,
      ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.q ? { OR: [{ name: { contains: filter.q, mode: "insensitive" } }, { jobTitle: { contains: filter.q, mode: "insensitive" } }] } : {}),
    },
    include: {
      department: { select: { name: true } },
      providerConfig: { select: { provider: true } },
      tools: { where: { effect: { not: "DENY" }, tool: { deletedAt: null } }, include: { tool: { select: { name: true, integrationKey: true, kind: true } } } },
      _count: { select: { knowledge: true } },
    },
    orderBy: [{ createdAt: "asc" }],
  });
  if (agents.length === 0) return [];
  const ids = agents.map((a) => a.id);
  const [grouped, running] = await Promise.all([
    prisma.task.groupBy({ by: ["agentId", "status"], where: { orgId, agentId: { in: ids }, status: { in: ["COMPLETED", "FAILED"] } }, _count: true }),
    prisma.task.findMany({
      where: { orgId, agentId: { in: ids }, status: { in: ["RUNNING", "AWAITING_APPROVAL", "WAITING"] }, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { agentId: true, title: true, progress: true, currentStep: true, status: true },
    }),
  ]);
  return agents.map((a) => {
    const done = grouped.find((g) => g.agentId === a.id && g.status === "COMPLETED")?._count ?? 0;
    const failed = grouped.find((g) => g.agentId === a.id && g.status === "FAILED")?._count ?? 0;
    const current = running.find((t) => t.agentId === a.id);
    // Show where the employee works (integrations), not every individual action.
    const toolNames = [
      ...new Set([
        ...a.tools.map((t) => (t.tool.integrationKey ? (getIntegration(t.tool.integrationKey)?.name ?? t.tool.name) : t.tool.kind === "CUSTOM_HTTP" ? t.tool.name : t.tool.name.split(" · ")[0])),
        ...(a._count.knowledge > 0 ? ["Knowledge"] : []),
      ]),
    ];
    return {
      id: a.id,
      name: a.name,
      jobTitle: a.jobTitle,
      department: a.department?.name ?? null,
      color: a.avatarColor,
      status: a.status,
      lifecycle: a.lifecycle,
      activity: current?.title ?? a.statusMessage ?? null,
      progress: current ? current.progress : null,
      tools: toolNames,
      tasksCompleted: done,
      successRate: done + failed > 0 ? Math.round((done / (done + failed)) * 100) : null,
      isOfflineModel: a.providerConfig?.provider === "OFFLINE",
    };
  });
}
