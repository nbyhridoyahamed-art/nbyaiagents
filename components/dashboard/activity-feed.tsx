import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Activity, BookOpen, CheckCircle2, Plug, Settings, ShieldCheck, Users, Workflow } from "lucide-react";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import type { ActivityItem } from "@/server/services/dashboard";

const CATEGORY_ICON: Record<string, typeof Activity> = {
  AGENT: Users,
  WORKFLOW: Workflow,
  APPROVAL: ShieldCheck,
  INTEGRATION: Plug,
  KNOWLEDGE: BookOpen,
  TASK: CheckCircle2,
  SYSTEM: Settings,
};

/** Operational timeline of what happened in the company (spec §91). */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <section aria-labelledby="activity-title" className="rounded-[14px] border bg-surface shadow-card">
      <header className="flex items-center justify-between border-b px-5 py-4">
        <h2 id="activity-title" className="text-card-title">
          Recent company activity
        </h2>
        <Link href="/analytics" className="text-[13px] font-medium text-brand hover:underline">
          Analytics
        </Link>
      </header>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <Activity className="size-8 text-text-muted" aria-hidden />
          <p className="text-[13.5px] font-medium">No activity yet</p>
          <p className="text-xs text-text-muted">Completed tasks, approvals and workflow runs will be recorded here.</p>
        </div>
      ) : (
        <ol className="relative px-5 py-4">
          {items.map((a, i) => {
            const Icon = CATEGORY_ICON[a.category] ?? Activity;
            const body = (
              <>
                <p className="text-[13.5px] font-medium">
                  {a.summary}
                  {a.isSimulation && <span className="ml-2 rounded bg-ai-soft px-1.5 py-0.5 align-middle text-[10.5px] font-semibold text-ai">Simulation</span>}
                </p>
                {a.detail && <p className="line-clamp-2 text-[13px] text-text-secondary">{a.detail}</p>}
                <p className="text-xs text-text-muted">
                  <time dateTime={a.at}>{formatDistanceToNow(new Date(a.at), { addSuffix: true })}</time>
                </p>
              </>
            );
            return (
              <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
                {i < items.length - 1 && <span aria-hidden className="absolute left-[15px] top-9 h-[calc(100%-36px)] w-px bg-border" />}
                {a.agent ? (
                  <AgentAvatar name={a.agent.name} color={a.agent.color} size={32} />
                ) : (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-secondary">
                    <Icon className="size-4" aria-hidden />
                  </span>
                )}
                <div className="min-w-0 flex-1 pt-0.5">
                  {a.link ? (
                    <Link href={a.link} className="block rounded-md hover:bg-surface-2/60">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
