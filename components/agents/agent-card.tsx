import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AgentCardData } from "@/server/services/agent-queries";
import { AgentAvatar } from "./agent-avatar";
import { AgentStatusBadge } from "./agent-status";

/** Workforce card (spec §81). All figures come from measured task data. */
export function AgentCard({ agent, className }: { agent: AgentCardData; className?: string }) {
  const extraTools = agent.tools.length - 2;
  return (
    <Link
      href={`/agents/${agent.id}`}
      className={cn(
        "group flex min-h-[220px] flex-col rounded-[14px] border bg-surface p-[18px] shadow-card transition-all duration-[170ms] hover:-translate-y-px hover:border-border-strong hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AgentAvatar name={agent.name} color={agent.color} status={agent.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-card-title">{agent.name}</p>
            <AgentStatusBadge status={agent.status} className="shrink-0" />
          </div>
          <p className="truncate text-[13px] text-text-secondary">{agent.jobTitle}</p>
        </div>
      </div>

      <div className="mt-4 min-h-[44px]">
        <p className="line-clamp-2 text-[13.5px] text-foreground">
          {agent.activity ?? <span className="text-text-muted">{agent.lifecycle === "DRAFT" ? "Draft — review and publish to start work." : "No active work."}</span>}
        </p>
      </div>

      {agent.progress !== null && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={agent.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${agent.name} progress`}>
            <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${agent.progress}%` }} />
          </div>
          <span className="text-xs font-medium tabular-nums text-text-secondary">{agent.progress}%</span>
        </div>
      )}

      <div className="mt-auto pt-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {agent.lifecycle === "DRAFT" && <span className="rounded-md bg-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-warning-text">Draft</span>}
          {agent.isOfflineModel && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">Offline demo model</span>}
          {agent.tools.slice(0, 2).map((t) => (
            <span key={t} className="rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
              {t}
            </span>
          ))}
          {extraTools > 0 && <span className="rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-text-muted">+{extraTools}</span>}
        </div>
        <p className="mt-3 border-t pt-3 text-xs text-text-muted">
          {agent.tasksCompleted} task{agent.tasksCompleted === 1 ? "" : "s"}
          {agent.successRate !== null ? ` · ${agent.successRate}% success` : " · no finished work yet"}
        </p>
      </div>
    </Link>
  );
}
