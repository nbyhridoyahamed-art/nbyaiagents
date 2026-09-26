import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import type { Priority, TaskStatus } from "@/lib/generated/prisma/enums";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { PriorityLabel, TaskStatusBadge } from "./task-status";

export interface TaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  mode: "LIVE" | "SIMULATION";
  agent: { id: string; name: string; color: string } | null;
  dueAt: string | null;
  updatedAt: string;
  currentStep: string | null;
}

/** Task list: a table on desktop, stacked cards on phones (no horizontal scrolling). */
export function TaskTable({ tasks }: { tasks: TaskRow[] }) {
  return (
    <div className="rounded-xl border bg-surface shadow-card">
      <table className="hidden w-full text-[13px] md:table">
        <thead className="border-b bg-surface-2/60 text-left text-xs text-text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium">Task</th>
            <th className="px-3 py-2.5 font-medium">Assigned</th>
            <th className="px-3 py-2.5 font-medium">Priority</th>
            <th className="px-3 py-2.5 font-medium">Deadline</th>
            <th className="px-3 py-2.5 font-medium">Updated</th>
            <th className="px-4 py-2.5 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {tasks.map((t) => (
            <tr key={t.id} className="hover:bg-surface-2/50">
              <td className="max-w-[360px] px-4 py-3">
                <Link href={`/tasks/${t.id}`} className="block truncate font-medium hover:underline">
                  {t.title}
                </Link>
                <span className="text-xs text-text-muted">
                  {t.currentStep ?? ""}
                  {t.mode === "SIMULATION" && <span className="ml-1 font-medium text-ai">· Simulation</span>}
                </span>
              </td>
              <td className="px-3 py-3">
                {t.agent ? (
                  <Link href={`/agents/${t.agent.id}`} className="flex items-center gap-2 hover:underline">
                    <AgentAvatar name={t.agent.name} color={t.agent.color} size={22} />
                    {t.agent.name}
                  </Link>
                ) : (
                  <span className="text-text-muted">Unassigned</span>
                )}
              </td>
              <td className="px-3 py-3">
                <PriorityLabel priority={t.priority} />
              </td>
              <td className="px-3 py-3 text-text-secondary">{t.dueAt ? new Date(t.dueAt).toLocaleDateString() : "—"}</td>
              <td className="px-3 py-3 text-text-muted">{formatDistanceToNow(new Date(t.updatedAt), { addSuffix: true })}</td>
              <td className="px-4 py-3 text-right">
                <TaskStatusBadge status={t.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y md:hidden">
        {tasks.map((t) => (
          <li key={t.id}>
            <Link href={`/tasks/${t.id}`} className="block p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{t.title}</p>
                <TaskStatusBadge status={t.status} />
              </div>
              <p className="mt-1 text-xs text-text-muted">
                {t.agent?.name ?? "Unassigned"} · <PriorityLabel priority={t.priority} /> · {formatDistanceToNow(new Date(t.updatedAt), { addSuffix: true })}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
