import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { RunStatusBadge } from "@/components/runs/run-status";
import { ExecutionTimeline } from "@/components/runs/execution-timeline";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { RichText } from "@/components/common/rich-text";
import { BreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { RunLiveRefresher } from "./run-live-refresher";

export const metadata: Metadata = { title: "Run" };

interface Citation {
  label: string;
  documentId: string;
  title: string;
  page: number | null;
  excerpt: string;
}

/** Observability view of one agent run (spec §54-55): correlated IDs, steps, tokens, cost. */
export default async function RunPage(props: PageProps<"/runs/[id]">) {
  const ctx = await requirePageContext("agents:read");
  const { id } = await props.params;
  const run = await prisma.agentRun.findFirst({
    where: { id, orgId: ctx.org.id },
    include: { agent: { select: { id: true, name: true, avatarColor: true, jobTitle: true } }, steps: { orderBy: { sequence: "asc" } } },
  });
  if (!run) notFound();
  const citations = (run.citations as Citation[] | null) ?? [];
  const live = ["QUEUED", "RUNNING"].includes(run.status);

  return (
    <PageContainer className="max-w-[1200px]">
      <BreadcrumbLabel segment={run.id} label={run.id} />
      {live && <RunLiveRefresher />}
      <PageHeader
        eyebrow="Agent run"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[22px]">{run.id}</span>
            <RunStatusBadge status={run.status} />
            {run.mode === "SIMULATION" && <span className="rounded bg-ai-soft px-2 py-0.5 text-xs font-semibold text-ai">Simulation — nothing real happened</span>}
          </span>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-6">
          <section className="rounded-xl border bg-surface p-5 shadow-card">
            <h2 className="text-card-title">Request</h2>
            <p className="mt-2 whitespace-pre-wrap text-[13.5px] text-text-secondary">{run.input}</p>
          </section>
          <section className="rounded-xl border bg-surface p-5 shadow-card">
            <h2 className="mb-4 text-card-title">What happened</h2>
            <ExecutionTimeline
              steps={run.steps.map((s) => ({
                id: s.id,
                label: s.label + (s.toolKey ? ` (${s.toolKey})` : ""),
                status: s.status,
                summary: [
                  (s.outputMeta as { summary?: string } | null)?.summary,
                  s.latencyMs ? `${s.latencyMs} ms` : null,
                  s.tokens ? `${s.tokens} tokens` : null,
                  s.costUsd ? `$${s.costUsd.toFixed(4)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
                error: s.error,
              }))}
            />
            <p className="mt-4 text-xs text-text-muted">Operational actions only. Model reasoning is never stored or shown.</p>
          </section>
          {(run.output || run.error) && (
            <section className="rounded-xl border bg-surface p-5 shadow-card">
              <h2 className="text-card-title">{run.error ? "Error" : "Result"}</h2>
              {run.error ? (
                <p className="mt-2 text-[13.5px] text-danger-text">{run.error}</p>
              ) : (
                <RichText text={run.output ?? ""} className="mt-2 text-[14px]" />
              )}
              {run.structuredOutput && (
                <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">{JSON.stringify(run.structuredOutput, null, 2)}</pre>
              )}
              {citations.length > 0 && (
                <ul className="mt-4 grid gap-1.5 border-t pt-3">
                  {citations.map((c) => (
                    <li key={c.label} className="text-xs">
                      <Link href={`/knowledge/documents/${c.documentId}${c.page ? `?page=${c.page}` : ""}`} className="font-medium text-brand hover:underline">
                        [{c.label}] {c.title}
                        {c.page ? ` · Page ${c.page}` : ""}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
        <aside className="grid content-start gap-6">
          <section className="rounded-xl border bg-surface p-5 shadow-card">
            <Link href={`/agents/${run.agent.id}`} className="flex items-center gap-3">
              <AgentAvatar name={run.agent.name} color={run.agent.avatarColor} size={40} />
              <span>
                <span className="block text-card-title">{run.agent.name}</span>
                <span className="block text-xs text-text-muted">{run.agent.jobTitle}</span>
              </span>
            </Link>
            <dl className="mt-4 grid gap-2 text-[13px]">
              {[
                ["Model", run.model ?? "—"],
                ["Agent version", run.agentVersion ? `v${run.agentVersion}` : "draft"],
                ["Tokens", `${run.inputTokens.toLocaleString()} in · ${run.outputTokens.toLocaleString()} out`],
                ["Estimated cost", `$${run.costUsd.toFixed(4)}`],
                ["Steps", String(run.stepCount)],
                ["Tool calls", String(run.toolCallCount)],
                ["Started", run.startedAt ? format(run.startedAt, "PPpp") : "—"],
                ["Finished", run.completedAt ? format(run.completedAt, "PPpp") : "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-text-muted">{k}</dt>
                  <dd className="text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="rounded-xl border bg-surface p-5 shadow-card">
            <h2 className="text-card-title">Correlation IDs</h2>
            <dl className="mt-3 grid gap-1.5 font-mono text-xs">
              <div>run: {run.id}</div>
              <div>agent: {run.agentId}</div>
              {run.taskId && (
                <div>
                  task:{" "}
                  <Link className="text-brand hover:underline" href={`/tasks/${run.taskId}`}>
                    {run.taskId}
                  </Link>
                </div>
              )}
              {run.workflowRunId && (
                <div>
                  workflow run:{" "}
                  <Link className="text-brand hover:underline" href={`/workflows/runs/${run.workflowRunId}`}>
                    {run.workflowRunId}
                  </Link>
                </div>
              )}
              {run.workflowNodeKey && <div>node: {run.workflowNodeKey}</div>}
              {run.parentRunId && (
                <div>
                  parent run:{" "}
                  <Link className="text-brand hover:underline" href={`/runs/${run.parentRunId}`}>
                    {run.parentRunId}
                  </Link>
                </div>
              )}
              {run.conversationId && <div>conversation: {run.conversationId}</div>}
            </dl>
          </section>
        </aside>
      </div>
    </PageContainer>
  );
}
