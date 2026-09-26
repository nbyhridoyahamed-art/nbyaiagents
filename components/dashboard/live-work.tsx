import Link from "next/link";
import { Check, CircleDashed, Hand, Loader2, X, Zap } from "lucide-react";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import type { LiveRun } from "@/server/services/dashboard";
import { cn } from "@/lib/utils";

function StepIcon({ status }: { status: string }) {
  if (status === "SUCCEEDED") return <Check className="size-3.5 text-success" aria-hidden />;
  if (status === "RUNNING") return <Loader2 className="size-3.5 animate-spin text-brand" aria-hidden />;
  if (status === "AWAITING_APPROVAL" || status === "WAITING") return <Hand className="size-3.5 text-warning" aria-hidden />;
  if (status === "FAILED" || status === "DENIED") return <X className="size-3.5 text-danger" aria-hidden />;
  return <CircleDashed className="size-3.5 text-text-muted" aria-hidden />;
}

const STEP_WORD: Record<string, string> = {
  SUCCEEDED: "done",
  RUNNING: "in progress",
  AWAITING_APPROVAL: "waiting for approval",
  WAITING: "waiting",
  FAILED: "failed",
  DENIED: "blocked",
  PENDING: "up next",
  SKIPPED: "skipped",
  CANCELLED: "cancelled",
};

/** Vertical execution timeline (spec §88). Operational steps only — never model reasoning. */
function Timeline({ steps }: { steps: LiveRun["steps"] }) {
  return (
    <ol className="relative mt-4 grid gap-3">
      {steps.map((s, i) => {
        const current = s.status === "RUNNING" || s.status === "AWAITING_APPROVAL" || s.status === "WAITING";
        return (
          <li key={s.id} className="relative flex items-start gap-3">
            {i < steps.length - 1 && <span aria-hidden className="absolute left-[11px] top-6 h-[calc(100%-6px)] w-px bg-border" />}
            <span className={cn("relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-surface", current && "border-brand/50 animate-pulse-soft")}>
              <StepIcon status={s.status} />
            </span>
            <span className={cn("pt-0.5 text-[13px]", s.status === "PENDING" ? "text-text-muted" : "text-foreground", current && "font-medium")}>
              {s.label}
              <span className="sr-only"> — {STEP_WORD[s.status] ?? s.status.toLowerCase()}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function LiveWork({ runs, activeRuns, activeWorkflowRuns }: { runs: LiveRun[]; activeRuns: number; activeWorkflowRuns: number }) {
  return (
    <section aria-labelledby="live-title" className="flex h-full flex-col rounded-[14px] border bg-surface shadow-card">
      <header className="flex items-center justify-between gap-2 border-b px-5 py-4">
        <h2 id="live-title" className="flex items-center gap-2 text-eyebrow text-brand">
          <span className={cn("size-2 rounded-full", runs.length ? "bg-brand animate-pulse-soft" : "bg-border-strong")} aria-hidden /> Live work
        </h2>
        <p className="text-xs text-text-muted">
          {activeRuns} employee run{activeRuns === 1 ? "" : "s"} · {activeWorkflowRuns} workflow run{activeWorkflowRuns === 1 ? "" : "s"} active
        </p>
      </header>
      {runs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center">
          <Zap className="size-8 text-text-muted" aria-hidden />
          <p className="text-[13.5px] font-medium">No live work right now</p>
          <p className="max-w-[280px] text-xs text-text-muted">When an employee starts a task or a workflow runs, you&apos;ll see each step here as it happens.</p>
        </div>
      ) : (
        <div className={cn("grid flex-1 gap-0 divide-y md:divide-y-0", runs.length > 1 && "md:grid-cols-2 md:divide-x")}>
          {runs.map((r) => (
            <article key={r.id} className="px-5 py-4">
              <div className="flex items-start gap-3">
                <AgentAvatar name={r.agent.name} color={r.agent.color} size={40} status={r.agent.status} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold">{r.agent.name}</p>
                  <p className="truncate text-xs text-text-muted">{r.agent.jobTitle}</p>
                </div>
                {r.mode === "SIMULATION" && <span className="rounded-md bg-ai-soft px-1.5 py-0.5 text-[11px] font-semibold text-ai">Simulation</span>}
              </div>
              <Link href={r.taskId ? `/tasks/${r.taskId}` : `/runs/${r.id}`} className="mt-3 block text-[14px] font-medium hover:underline">
                {r.title}
              </Link>
              {r.steps.length > 0 ? <Timeline steps={r.steps} /> : <p className="mt-3 text-xs text-text-muted">Starting…</p>}
              {r.progress !== null && (
                <div className="mt-4 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={r.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.title} progress`}>
                    <div className="h-full rounded-full bg-brand" style={{ width: `${r.progress}%` }} />
                  </div>
                  <span className="text-xs font-medium tabular-nums text-text-secondary">{r.progress}%</span>
                </div>
              )}
              <Link href={`/runs/${r.id}`} className="mt-3 inline-block text-xs font-medium text-brand hover:underline">
                Open run details
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
