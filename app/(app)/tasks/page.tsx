import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { TaskStatus } from "@/lib/generated/prisma/enums";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { EmptyState } from "@/components/common/empty-state";
import { NewTaskDialog } from "@/components/tasks/new-task-dialog";
import { TaskTable } from "@/components/tasks/task-table";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tasks" };

const FILTERS: { key: string; label: string; statuses?: TaskStatus[] }[] = [
  { key: "active", label: "Active", statuses: ["QUEUED", "RUNNING", "WAITING", "AWAITING_APPROVAL"] },
  { key: "attention", label: "Needs attention", statuses: ["WAITING", "AWAITING_APPROVAL"] },
  { key: "completed", label: "Completed", statuses: ["COMPLETED"] },
  { key: "failed", label: "Failed", statuses: ["FAILED", "CANCELLED"] },
  { key: "all", label: "All" },
];

export default async function TasksPage(props: PageProps<"/tasks">) {
  const ctx = await requirePageContext("tasks:read");
  const sp = await props.searchParams;
  const filter = FILTERS.find((f) => f.key === sp.filter) ?? FILTERS[0];
  const agentId = typeof sp.agent === "string" ? sp.agent : undefined;
  const where: Prisma.TaskWhereInput = {
    orgId: ctx.org.id,
    deletedAt: null,
    ...(filter.statuses ? { status: { in: filter.statuses } } : {}),
    ...(agentId ? { agentId } : {}),
  };
  const [tasks, agents, counts] = await Promise.all([
    prisma.task.findMany({ where, orderBy: [{ updatedAt: "desc" }], take: 100, include: { agent: { select: { id: true, name: true, avatarColor: true } } } }),
    prisma.agent.findMany({ where: { orgId: ctx.org.id, deletedAt: null }, select: { id: true, name: true, jobTitle: true, lifecycle: true }, orderBy: { name: "asc" } }),
    prisma.task.groupBy({ by: ["status"], where: { orgId: ctx.org.id, deletedAt: null }, _count: true }),
  ]);
  const count = (statuses?: TaskStatus[]) => counts.filter((c) => !statuses || statuses.includes(c.status)).reduce((s, c) => s + c._count, 0);

  return (
    <PageContainer>
      <PageHeader
        title="Tasks"
        description="Structured work you've given your AI employees. Tasks run in the background — you can close this page."
        actions={ctx.can("tasks:write") && <NewTaskDialog agents={agents.map((a) => ({ id: a.id, name: a.name, jobTitle: a.jobTitle, published: a.lifecycle === "PUBLISHED" }))} />}
      />
      <nav aria-label="Task filters" className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/tasks?filter=${f.key}${agentId ? `&agent=${agentId}` : ""}`}
            aria-current={f.key === filter.key ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-[13px] font-medium",
              f.key === filter.key ? "border-brand bg-brand-soft text-brand-hover" : "text-text-secondary hover:bg-surface-2",
            )}
          >
            {f.label} <span className="text-text-muted">{count(f.statuses)}</span>
          </Link>
        ))}
      </nav>
      {tasks.length === 0 ? (
        <EmptyState icon={ListChecks} title={filter.key === "all" ? "No tasks yet" : `No ${filter.label.toLowerCase()} tasks`} description="Give an AI employee structured work. It runs in the background and asks for approval when needed." />
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
    </PageContainer>
  );
}
