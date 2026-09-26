import { prisma } from "@/lib/db";
import type { AgentWithConfig } from "@/server/services/agents";
import { WorkflowsAssign } from "./workflows-assign";

export async function WorkflowsTab({ agent, orgId, canEdit }: { agent: AgentWithConfig; orgId: string; canEdit: boolean }) {
  const workflows = await prisma.workflow.findMany({
    where: { orgId, deletedAt: null },
    select: { id: true, name: true, status: true, description: true, _count: { select: { runs: true } } },
    orderBy: { name: "asc" },
  });
  return (
    <WorkflowsAssign
      agentId={agent.id}
      canEdit={canEdit}
      assigned={agent.workflows.map((w) => w.workflowId)}
      workflows={workflows.map((w) => ({ id: w.id, name: w.name, status: w.status, description: w.description, runs: w._count.runs }))}
    />
  );
}
