import type { Metadata } from "next";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { requirePageContext } from "@/lib/auth/context";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { formatDuration, formatNumber, formatPercent, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  RANGES,
  buildFilter,
  getAgentPerformance,
  getDailySeries,
  getModelUsage,
  getOverview,
  getRecentErrors,
  getWorkflowAnalytics,
  previousFilter,
  type RangeKey,
} from "@/server/services/analytics";
import { CostChart, ExecutionsChart } from "./charts-loader";

export const metadata: Metadata = { title: "Analytics" };

function Delta({ now, before, invert = false }: { now: number; before: number; invert?: boolean }) {
  if (before === 0) return <span className="text-xs text-text-muted">no earlier data</span>;
  const pct = Math.round(((now - before) / before) * 100);
  const good = invert ? pct <= 0 : pct >= 0;
  return <span className={cn("text-xs font-medium", pct === 0 ? "text-text-muted" : good ? "text-success-text" : "text-danger-text")}>{pct > 0 ? "+" : ""}{pct}% vs previous period</span>;
}

function Kpi({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border bg-surface p-4 shadow-card">
      <p className="text-[13px] font-medium text-text-secondary">{label}</p>
      <p className="mt-2 text-kpi">{value}</p>
      <div className="mt-1 min-h-4">{children}</div>
    </div>
  );
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[14px] border bg-surface shadow-card">
      <header className="border-b px-5 py-4">
        <h2 className="text-card-title">{title}</h2>
        {description && <p className="text-xs text-text-muted">{description}</p>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default async function AnalyticsPage(props: PageProps<"/analytics">) {
  const ctx = await requirePageContext("analytics:read");
  const sp = await props.searchParams;
  const range: RangeKey = typeof sp.range === "string" && sp.range in RANGES ? (sp.range as RangeKey) : "30d";
  const includeSims = sp.tests === "1";
  const f = buildFilter(range, ctx.org.timezone, includeSims);
  const [overview, before, series, agents, workflows, models, errors] = await Promise.all([
    getOverview(ctx.org.id, f),
    getOverview(ctx.org.id, previousFilter(f)),
    getDailySeries(ctx.org.id, f),
    getAgentPerformance(ctx.org.id, f),
    getWorkflowAnalytics(ctx.org.id, f),
    getModelUsage(ctx.org.id, f),
    getRecentErrors(ctx.org.id, f),
  ]);
  const href = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ range, ...(includeSims ? { tests: "1" } : {}), ...patch });
    if (q.get("tests") === "0") q.delete("tests");
    return `/analytics?${q.toString()}`;
  };

  return (
    <PageContainer className="grid gap-5">
      <PageHeader
        title="Analytics"
        description="Measured results only: executions, success, duration, tokens and estimated cost recorded while work ran."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="Date range" className="inline-flex rounded-xl border bg-surface p-1">
              {(Object.keys(RANGES) as RangeKey[]).map((r) => (
                <Link key={r} href={href({ range: r })} aria-current={r === range ? "page" : undefined} className={cn("rounded-lg px-3 py-1 text-[13px] font-medium", r === range ? "bg-brand-soft text-brand-hover" : "text-text-secondary hover:bg-surface-2")}>
                  {r.replace("d", " days")}
                </Link>
              ))}
            </nav>
            <Link href={href({ tests: includeSims ? "0" : "1" })} className="rounded-xl border bg-surface px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-2">
              {includeSims ? "Including test runs" : "Live work only"}
            </Link>
          </div>
        }
      />
      {ctx.org.isDemo && <p className="rounded-lg bg-ai-soft px-3 py-2 text-[12.5px] text-ai">This workspace contains seeded demo data; its history and usage are sample records.</p>}

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-6">
        <Kpi label="Executions" value={formatNumber(overview.executions.total)}>
          <Delta now={overview.executions.total} before={before.executions.total} />
        </Kpi>
        <Kpi label="Success rate" value={formatPercent(overview.successRate)}>
          <span className="text-xs text-text-muted">{overview.succeeded} ok · {overview.failed} failed</span>
        </Kpi>
        <Kpi label="Tasks completed" value={formatNumber(overview.tasks.completed)}>
          <span className="text-xs text-text-muted">avg {formatDuration(overview.tasks.avgDurationMs)}</span>
        </Kpi>
        <Kpi label="AI tokens" value={formatNumber(overview.tokens.total)}>
          <Delta now={overview.tokens.total} before={before.tokens.total} invert />
        </Kpi>
        <Kpi label="Estimated cost" value={formatUsd(overview.costUsd)}>
          <Delta now={overview.costUsd} before={before.costUsd} invert />
        </Kpi>
        <Kpi label="Errors" value={formatNumber(overview.errors)}>
          <span className="text-xs text-text-muted">{overview.escalations} escalation{overview.escalations === 1 ? "" : "s"}</span>
        </Kpi>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Executions per day" description="Employee runs and workflow runs, by outcome.">
          <ExecutionsChart data={series} />
        </Card>
        <Card title="Estimated AI cost per day" description="From recorded token usage × each model's list price.">
          <CostChart data={series} />
        </Card>
      </div>

      <Card title="Employee performance">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b text-left text-xs text-text-muted">
                {["Employee", "Tasks done", "Success", "Avg task time", "Runs", "Run errors", "Escalations", "Tokens", "Est. cost"].map((h, i) => (
                  <th key={h} scope="col" className={cn("py-2 pr-3 font-medium", i > 0 && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {agents.map((a) => (
                <tr key={a.id}>
                  <th scope="row" className="py-2.5 pr-3 text-left font-medium">
                    <Link href={`/agents/${a.id}`} className="flex items-center gap-2 hover:underline">
                      <AgentAvatar name={a.name} color={a.color} size={24} /> {a.name}
                    </Link>
                  </th>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{a.tasksCompleted}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{formatPercent(a.successRate)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{formatDuration(a.avgTaskMs)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{a.runs}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{a.runErrors}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{a.escalations}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{formatNumber(a.tokens)}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatUsd(a.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Workflow performance">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-xs text-text-muted">
                  {["Workflow", "Runs", "Completion", "Avg duration", "Failures", "Last run"].map((h, i) => (
                    <th key={h} scope="col" className={cn("py-2 pr-3 font-medium", i > 0 && i < 5 && "text-right")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {workflows.map((w) => (
                  <tr key={w.id}>
                    <th scope="row" className="py-2.5 pr-3 text-left font-medium"><Link href={`/workflows/${w.id}`} className="hover:underline">{w.name}</Link></th>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{w.runs}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{formatPercent(w.completionRate)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{formatDuration(w.avgDurationMs)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{w.failed}</td>
                    <td className="py-2.5 text-text-secondary">{w.lastRunAt ? formatDistanceToNow(new Date(w.lastRunAt), { addSuffix: true }) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {workflows.length === 0 && <p className="py-6 text-center text-[13px] text-text-muted">No workflow runs in this period.</p>}
          </div>
        </Card>
        <Card title="AI usage by model" description={`Embeddings: ${formatNumber(models.embeddings.tokens)} tokens across ${formatNumber(models.embeddings.chunks)} chunks.`}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-left text-xs text-text-muted">
                {["Provider · model", "Calls", "Input", "Output", "Est. cost"].map((h, i) => (
                  <th key={h} scope="col" className={cn("py-2 pr-3 font-medium", i > 0 && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {models.rows.map((m) => (
                <tr key={`${m.provider}-${m.model}`}>
                  <th scope="row" className="py-2.5 pr-3 text-left font-medium">{m.model === "demo-seed" ? "Demo data (seeded)" : `${(m.provider ?? "unknown").toLowerCase()} · ${m.model ?? "unknown"}`}</th>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{formatNumber(m.calls)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{formatNumber(m.inputTokens)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{formatNumber(m.outputTokens)}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatUsd(m.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {models.rows.length === 0 && <p className="py-6 text-center text-[13px] text-text-muted">No AI model calls in this period.</p>}
        </Card>
      </div>

      <Card title="Recent errors" description="Failed employee runs, failed workflow runs and failed tool calls in this period.">
        {errors.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-text-muted">No errors in this period.</p>
        ) : (
          <ul className="divide-y">
            {errors.map((e) => (
              <li key={`${e.source}-${e.id}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5 text-[13px]">
                <span className="w-20 shrink-0 text-xs capitalize text-text-muted">{e.source}</span>
                <span className="font-medium">{e.who}</span>
                <span className="min-w-0 flex-1 text-text-secondary">{e.message}</span>
                <span className="text-xs text-text-muted">{formatDistanceToNow(new Date(e.at), { addSuffix: true })}</span>
                {e.href && <Link href={e.href} className="text-xs text-brand hover:underline">Inspect</Link>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-xs text-text-muted">
        Methodology: every figure is counted from recorded runs, tasks and usage. Cost is an estimate (recorded tokens × list price per model; unknown models count as $0). Days follow your company time zone ({ctx.org.timezone}). No productivity or time-saved estimates are shown.
      </p>
    </PageContainer>
  );
}
