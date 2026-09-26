import Link from "next/link";
import { formatDistanceToNow, startOfMonth } from "date-fns";
import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { prisma } from "@/lib/db";
import type { AgentWithConfig, ValidationIssue } from "@/server/services/agents";
import { Button } from "@/components/ui/button";
import { PERSONALITIES } from "@/lib/agents/schema";

export async function OverviewTab({ agent, issues, orgId }: { agent: AgentWithConfig; issues: ValidationIssue[]; orgId: string }) {
  const monthStart = startOfMonth(new Date());
  const [completed, failed, escalated, runsThisMonth, usage, activeTasks, versions] = await Promise.all([
    prisma.task.count({ where: { orgId, agentId: agent.id, status: "COMPLETED" } }),
    prisma.task.count({ where: { orgId, agentId: agent.id, status: "FAILED" } }),
    prisma.agentRun.count({ where: { orgId, agentId: agent.id, escalated: true } }),
    prisma.agentRun.count({ where: { orgId, agentId: agent.id, createdAt: { gte: monthStart }, mode: "LIVE" } }),
    prisma.usageRecord.aggregate({ where: { orgId, agentId: agent.id, createdAt: { gte: monthStart }, isSimulation: false }, _sum: { costUsd: true } }),
    prisma.task.findMany({
      where: { orgId, agentId: agent.id, status: { in: ["QUEUED", "RUNNING", "WAITING", "AWAITING_APPROVAL"] }, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    prisma.agentVersion.findMany({ where: { agentId: agent.id }, orderBy: { version: "desc" }, take: 5 }),
  ]);
  const successRate = completed + failed > 0 ? `${Math.round((completed / (completed + failed)) * 100)}%` : "—";
  const cost = usage._sum.costUsd ?? 0;
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="grid gap-6">
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Performance">
          {[
            ["Tasks completed", String(completed)],
            ["Success rate", successRate],
            ["Runs this month", String(runsThisMonth)],
            ["Est. cost this month", `$${cost.toFixed(2)}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-surface p-4 shadow-card">
              <p className="text-xs font-medium text-text-muted">{label}</p>
              <p className="mt-1 text-[22px] font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-xl border bg-surface p-5 shadow-card">
          <h2 className="text-card-title">Role</h2>
          {agent.description && <p className="mt-1 text-[13.5px] text-text-secondary">{agent.description}</p>}
          <dl className="mt-4 grid gap-4 text-[13.5px] md:grid-cols-2">
            <div className="md:col-span-2">
              <dt className="text-xs font-medium text-text-muted">Mission</dt>
              <dd>{agent.mission || "—"}</dd>
            </div>
            <ListBlock label="Responsibilities" items={agent.responsibilities} />
            <ListBlock label="Goals" items={agent.goals} />
            <ListBlock label="KPIs" items={agent.kpis} />
            <div>
              <dt className="text-xs font-medium text-text-muted">Personality</dt>
              <dd>{PERSONALITIES.find((p) => p.key === agent.personality)?.label ?? agent.personality}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="text-card-title">Current work</h2>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/agents/${agent.id}?tab=tasks`}>All tasks</Link>
            </Button>
          </div>
          {activeTasks.length === 0 ? (
            <p className="mt-3 text-[13px] text-text-muted">No active tasks.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {activeTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2.5">
                  <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate text-[13.5px] font-medium hover:underline">
                    {t.title}
                  </Link>
                  <span className="text-xs capitalize text-text-muted">{t.status.toLowerCase().replace("_", " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid content-start gap-6">
        <section className="rounded-xl border bg-surface p-5 shadow-card" aria-label="Readiness">
          <h2 className="text-card-title">Readiness</h2>
          {issues.length === 0 ? (
            <p className="mt-3 flex items-center gap-2 text-[13px] text-success-text">
              <CheckCircle2 className="size-4" aria-hidden /> Ready to work.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2.5">
              {[...errors, ...warnings].map((i, idx) => (
                <li key={idx} className="flex gap-2 text-[13px]">
                  {i.level === "error" ? (
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-label="Blocking" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Warning" />
                  )}
                  <span className="min-w-0">
                    {i.message}
                    {i.fixHref && (
                      <Link href={i.fixHref} className="ml-1 font-medium text-brand hover:underline">
                        {i.fixLabel ?? "Fix"}
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 border-t pt-3 text-xs text-text-muted">
            {escalated} escalation{escalated === 1 ? "" : "s"} to humans so far.
          </p>
        </section>

        <section className="rounded-xl border bg-surface p-5 shadow-card">
          <h2 className="text-card-title">Versions</h2>
          {versions.length === 0 ? (
            <p className="mt-3 text-[13px] text-text-muted">Not published yet. Draft v{agent.draftVersion}.</p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {versions.map((v) => (
                <li key={v.id} className="text-[13px]">
                  <span className="font-medium">v{v.version}</span>{" "}
                  <span className="text-text-muted">
                    · {v.status.toLowerCase()} · {formatDistanceToNow(v.createdAt, { addSuffix: true })}
                  </span>
                  {v.notes && <p className="text-xs text-text-secondary">{v.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function ListBlock({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd>
        {items.length === 0 ? (
          "—"
        ) : (
          <ul className="list-disc pl-4">
            {items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}
