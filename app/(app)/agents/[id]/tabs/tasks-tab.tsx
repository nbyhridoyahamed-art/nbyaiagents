import { ListChecks } from "lucide-react";
import { prisma } from "@/lib/db";
import { EmptyState } from "@/components/common/empty-state";
import { NewTaskDialog } from "@/components/tasks/new-task-dialog";
import { TaskTable } from "@/components/tasks/task-table";

export async function TasksTab({ agentId, orgId, canWrite }: { agentId: string; orgId: string; canWrite: boolean }) {
  const [tasks, agent] = await Promise.all([
    prisma.task.findMany({
      where: { orgId, agentId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { agent: { select: { id: true, name: true, avatarColor: true } } },
    }),
    prisma.agent.findFirstOrThrow({ where: { id: agentId, orgId }, select: { id: true, name: true, jobTitle: true, lifecycle: true } }),
  ]);
  const agents = [{ id: agent.id, name: agent.name, jobTitle: agent.jobTitle, published: agent.lifecycle === "PUBLISHED" }];
  return (
    <div className="grid gap-4">
      {canWrite && (
        <div className="flex justify-end">
          <NewTaskDialog agents={agents} defaultAgentId={agentId} />
        </div>
      )}
      {tasks.length === 0 ? (
        <EmptyState icon={ListChecks} title={`No tasks for ${agent.name} yet`} description="Assign structured work — it runs in the background and appears here." />
      ) : (
        <TaskTable
          tasks={tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            mode: t.mode,
            agent: t.agent ? { id: t.agent.id, name: t.agent.name, color: t.agent.avatarColor } : null,
            dueAt: t.dueAt?.toISOString() ?? null,
            updatedAt: t.updatedAt.toISOString(),
            currentStep: t.currentStep,
          }))}
        />
      )}
    </div>
  );
}
