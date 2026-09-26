import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { BreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { PriorityLabel, TaskStatusBadge } from "@/components/tasks/task-status";
import { ExecutionTimeline } from "@/components/runs/execution-timeline";
import { RichText } from "@/components/common/rich-text";
import { RunLiveRefresher } from "@/app/(app)/runs/[id]/run-live-refresher";
import { TakeoverPanel, TaskActions } from "./task-actions";
import { TaskComments } from "./task-comments";

export const metadata: Metadata = { title: "Task" };

export default async function TaskPage(props: PageProps<"/tasks/[id]">) {
  const ctx = await requirePageContext("tasks:read");
  const { id } = await props.params;
  const task = await prisma.task.findFirst({
    where: { id, orgId: ctx.org.id, deletedAt: null },
    include: {
      agent: { select: { id: true, name: true, avatarColor: true, jobTitle: true } },
      assignee: { select: { id: true, name: true } },
      comments: { orderBy: { createdAt: "asc" } },
      subtasks: { where: { deletedAt: null }, select: { id: true, title: true, status: true } },
    },
  });
  if (!task) notFound();
  const [runs, approvals, authors] = await Promise.all([
    prisma.agentRun.findMany({ where: { taskId: id }, orderBy: { createdAt: "desc" }, include: { steps: { orderBy: { sequence: "asc" } } }, take: 5 }),
    prisma.approval.findMany({ where: { taskId: id, status: "PENDING" } }),
    prisma.user.findMany({ where: { id: { in: task.comments.map((c) => c.authorUserId).filter(Boolean) as string[] } }, select: { id: true, name: true } }),
  ]);
  const latest = runs[0];
  const hasActiveRun = runs.some((r) => ["QUEUED", "RUNNING", "AWAITING_APPROVAL", "WAITING"].includes(r.status));
  const takenOver = !!task.assigneeUserId;
  const live = !takenOver && hasActiveRun && ["QUEUED", "RUNNING"].includes(task.status);

  return (
    <PageContainer className="max-w-[1200px]">
      <BreadcrumbLabel segment={task.id} label={task.title} />
      {live && <RunLiveRefresher />}
      <PageHeader
        eyebrow="Task"
        title={task.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge status={task.status} /> <PriorityLabel priority={task.priority} />
            {task.mode === "SIMULATION" && <span className="rounded bg-ai-soft px-2 text-xs font-semibold text-ai">Simulation — nothing real happens</span>}
            <span className="text-xs text-text-muted">
              Created {formatDistanceToNow(task.createdAt, { addSuffix: true })}
              {task.dueAt ? ` · due ${format(task.dueAt, "PPp")}` : ""}
            </span>
          </span>
        }
        actions={ctx.can("tasks:write") && <TaskActions taskId={task.id} status={task.status} hasAgent={!!task.agent} hasActiveRun={hasActiveRun} takenOver={takenOver} />}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-6">
          {takenOver && task.assigneeUserId === ctx.user.id && !["COMPLETED", "CANCELLED"].includes(task.status) && ctx.can("tasks:write") && (
            <TakeoverPanel taskId={task.id} agentName={task.agent?.name ?? null} canHandBack={!!task.agent} />
          )}
          {approvals.length > 0 && (
            <div className="rounded-xl border border-warning/40 bg-warning-soft p-4 text-[13.5px] text-warning-text">
              Waiting for you: {approvals.map((a) => a.title).join("; ")}.{" "}
              <Link href={approvals[0].kind === "TOOL_ACTION" ? `/approvals?focus=${approvals[0].id}` : "/inbox"} className="font-semibold underline">
                Review
              </Link>
            </div>
          )}
          {task.description && (
            <section className="rounded-xl border bg-surface p-5 shadow-card">
              <h2 className="text-card-title">Details</h2>
              <p className="mt-2 whitespace-pre-wrap text-[13.5px] text-text-secondary">{task.description}</p>
              {task.inputs && Object.keys(task.inputs as object).length > 0 && (
                <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">{JSON.stringify(task.inputs, null, 2)}</pre>
              )}
            </section>
          )}
          {latest && (
            <section className="rounded-xl border bg-surface p-5 shadow-card">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-card-title">{live ? `${task.agent?.name ?? "Employee"} is working…` : takenOver ? `What ${task.agent?.name ?? "the employee"} did before the takeover` : "What happened"}</h2>
                <Link href={`/runs/${latest.id}`} className="font-mono text-xs text-brand hover:underline">
                  {latest.id}
                </Link>
              </div>
              <ExecutionTimeline
                steps={latest.steps
                  .filter((s) => s.type !== "CONTEXT")
                  .map((s) => ({ id: s.id, label: s.label, status: s.status, summary: (s.outputMeta as { summary?: string } | null)?.summary, error: s.error }))}
              />
            </section>
          )}
          {(task.result || task.error) && (
            <section className="rounded-xl border bg-surface p-5 shadow-card">
              <h2 className="text-card-title">{task.error ? "Why it stopped" : "Result"}</h2>
              {task.error ? <p className="mt-2 text-[13.5px] text-danger-text">{task.error}</p> : <RichText text={task.result ?? ""} className="mt-2 text-[14px]" />}
            </section>
          )}
          <TaskComments
            taskId={task.id}
            canWrite={ctx.can("tasks:write")}
            comments={task.comments.map((c) => ({
              id: c.id,
              body: c.body,
              author: c.authorUserId ? (authors.find((a) => a.id === c.authorUserId)?.name ?? "Teammate") : "AI employee",
              createdAt: c.createdAt.toISOString(),
            }))}
          />
        </div>
        <aside className="grid content-start gap-6">
          <section className="rounded-xl border bg-surface p-5 shadow-card">
            <h2 className="text-card-title">Assigned to</h2>
            {task.assignee && (
              <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-[12.5px] text-warning-text">
                Taken over by <strong>{task.assignee.id === ctx.user.id ? "you" : task.assignee.name}</strong>
                {task.takenOverAt ? ` ${formatDistanceToNow(task.takenOverAt, { addSuffix: true })}` : ""}
              </p>
            )}
            {task.agent ? (
              <Link href={`/agents/${task.agent.id}`} className="mt-3 flex items-center gap-3">
                <AgentAvatar name={task.agent.name} color={task.agent.avatarColor} size={40} />
                <span>
                  <span className="block text-[14px] font-semibold">{task.agent.name}</span>
                  <span className="block text-xs text-text-muted">{task.agent.jobTitle}</span>
                </span>
              </Link>
            ) : (
              <p className="mt-2 text-[13px] text-text-muted">Unassigned.</p>
            )}
            <dl className="mt-4 grid gap-1.5 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-text-muted">Task ID</dt>
                <dd className="font-mono text-xs">{task.id}</dd>
              </div>
              {task.workflowRunId && (
                <div className="flex justify-between">
                  <dt className="text-text-muted">Workflow run</dt>
                  <dd>
                    <Link href={`/workflows/runs/${task.workflowRunId}`} className="font-mono text-xs text-brand hover:underline">
                      {task.workflowRunId}
                    </Link>
                  </dd>
                </div>
              )}
              {task.startedAt && (
                <div className="flex justify-between">
                  <dt className="text-text-muted">Started</dt>
                  <dd>{format(task.startedAt, "PPp")}</dd>
                </div>
              )}
              {task.completedAt && (
                <div className="flex justify-between">
                  <dt className="text-text-muted">Finished</dt>
                  <dd>{format(task.completedAt, "PPp")}</dd>
                </div>
              )}
            </dl>
          </section>
          {runs.length > 1 && (
            <section className="rounded-xl border bg-surface p-5 shadow-card">
              <h2 className="text-card-title">History</h2>
              <ul className="mt-3 grid gap-1.5 text-[13px]">
                {runs.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2">
                    <Link href={`/runs/${r.id}`} className="font-mono text-xs text-brand hover:underline">
                      {r.id}
                    </Link>
                    <span className="text-xs capitalize text-text-muted">{r.status.toLowerCase().replace("_", " ")}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {task.subtasks.length > 0 && (
            <section className="rounded-xl border bg-surface p-5 shadow-card">
              <h2 className="text-card-title">Delegated sub-tasks</h2>
              <ul className="mt-3 grid gap-1.5 text-[13px]">
                {task.subtasks.map((s) => (
                  <li key={s.id} className="flex justify-between gap-2">
                    <Link href={`/tasks/${s.id}`} className="truncate hover:underline">
                      {s.title}
                    </Link>
                    <TaskStatusBadge status={s.status} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </PageContainer>
  );
}
