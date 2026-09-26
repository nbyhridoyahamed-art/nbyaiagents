import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { BreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { RunStatusBadge } from "@/components/runs/run-status";
import { graphFromRows } from "@/lib/workflows/validate-graph";
import { RunLiveRefresher } from "@/app/(app)/runs/[id]/run-live-refresher";
import { RunGraphLoader } from "./run-graph-loader";
import { RunControls } from "./run-controls";

export const metadata: Metadata = { title: "Workflow run" };

export default async function WorkflowRunPage(props: PageProps<"/workflows/runs/[runId]">) {
  const ctx = await requirePageContext("workflows:read");
  const { runId } = await props.params;
  const run = await prisma.workflowRun.findFirst({
    where: { id: runId, orgId: ctx.org.id },
    include: { workflow: { select: { id: true, name: true } }, steps: { orderBy: { sequence: "asc" } } },
  });
  if (!run) notFound();
  const [nodes, edges, approvals] = await Promise.all([
    prisma.workflowNode.findMany({ where: { versionId: run.versionId } }),
    prisma.workflowEdge.findMany({ where: { versionId: run.versionId } }),
    prisma.approval.findMany({ where: { workflowRunId: run.id, status: "PENDING" } }),
  ]);
  const graph = graphFromRows(nodes, edges);
  const state = run.state as { nodes?: Record<string, { status: string; error?: string }> };
  const nodeStatus = Object.fromEntries(Object.entries(state.nodes ?? {}).map(([k, v]) => [k, v.status]));
  const live = ["QUEUED", "RUNNING"].includes(run.status);

  return (
    <PageContainer>
      <BreadcrumbLabel segment="runs" label={run.workflow.name} />
      <BreadcrumbLabel segment={run.id} label={run.id} />
      {live && <RunLiveRefresher />}
      <PageHeader
        eyebrow={
          <Link href={`/workflows/${run.workflow.id}`} className="hover:underline">
            {run.workflow.name} · v{run.version}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[22px]">{run.id}</span>
            <RunStatusBadge status={run.status} />
            {run.mode === "SIMULATION" && <span className="rounded bg-ai-soft px-2 py-0.5 text-xs font-semibold text-ai">Simulation — nothing real happened</span>}
          </span>
        }
        actions={ctx.can("workflows:run") && <RunControls runId={run.id} status={run.status} />}
      />
      {approvals.length > 0 && (
        <div className="mb-5 rounded-xl border border-warning/40 bg-warning-soft p-4 text-[13.5px] text-warning-text">
          Waiting for you: {approvals.map((a) => a.title).join("; ")}.{" "}
          <Link href={approvals[0].kind === "TOOL_ACTION" || approvals[0].kind === "REVIEW" ? `/approvals?focus=${approvals[0].id}` : "/inbox"} className="font-semibold underline">
            Review now
          </Link>
        </div>
      )}
      {run.error && <p className="mb-5 rounded-xl bg-danger-soft px-4 py-3 text-[13.5px] text-danger-text">{run.error}</p>}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="h-[520px] overflow-hidden rounded-xl border bg-surface shadow-card" aria-label="Run graph">
          <RunGraphLoader graph={graph} statuses={nodeStatus} />
        </section>
        <div className="grid content-start gap-6">
          <section className="rounded-xl border bg-surface p-5 shadow-card">
            <h2 className="text-card-title">Summary</h2>
            <dl className="mt-3 grid gap-1.5 text-[13px]">
              {[
                ["Trigger", run.trigger.toLowerCase()],
                ["Progress", `${run.progress}%`],
                ["Steps", String(run.stepCount)],
                ["Tool calls", String(run.toolCallCount)],
                ["AI tokens", run.tokenCount.toLocaleString()],
                ["Estimated cost", `$${run.costUsd.toFixed(4)}`],
                ["Started", run.startedAt ? format(run.startedAt, "PPpp") : "—"],
                ["Finished", run.completedAt ? format(run.completedAt, "PPpp") : "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-text-muted">{k}</dt>
                  <dd className="text-right capitalize">{v}</dd>
                </div>
              ))}
            </dl>
            {run.output !== null && run.output !== undefined && (
              <>
                <h3 className="mt-4 text-[13px] font-semibold">Output</h3>
                <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11.5px]">{JSON.stringify(run.output, null, 2)}</pre>
              </>
            )}
            <h3 className="mt-4 text-[13px] font-semibold">Trigger input</h3>
            <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11.5px]">{JSON.stringify(run.triggerPayload, null, 2)}</pre>
          </section>
        </div>
      </div>
      <section className="mt-6 rounded-xl border bg-surface shadow-card" aria-labelledby="steps-title">
        <h2 id="steps-title" className="border-b px-5 py-4 text-card-title">
          Steps
        </h2>
        {run.steps.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-text-muted">No steps have run yet.</p>
        ) : (
          <ol className="divide-y">
            {run.steps.map((s) => (
              <li key={s.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-6 text-xs tabular-nums text-text-muted">{s.sequence}</span>
                  <span className="text-[13.5px] font-medium">{s.label}</span>
                  <span className="font-mono text-[11px] text-text-muted">
                    {s.nodeType} · {s.nodeKey}
                    {s.attempt > 1 ? ` · attempt ${s.attempt}` : ""}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {s.agentRunId && (
                      <Link href={`/runs/${s.agentRunId}`} className="font-mono text-[11px] text-brand hover:underline">
                        {s.agentRunId}
                      </Link>
                    )}
                    <StepBadge status={s.status} />
                  </span>
                </div>
                {s.error && <p className="ml-8 mt-1 text-[12.5px] text-danger-text">{s.error}</p>}
                {(s.input !== null || s.output !== null) && (
                  <details className="ml-8 mt-1.5">
                    <summary className="cursor-pointer text-xs text-text-muted">Input &amp; output</summary>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {s.input !== null && <pre className="max-h-48 overflow-auto rounded-lg bg-surface-2 p-2 font-mono text-[11px]">{JSON.stringify(s.input, null, 2)}</pre>}
                      {s.output !== null && <pre className="max-h-48 overflow-auto rounded-lg bg-surface-2 p-2 font-mono text-[11px]">{JSON.stringify(s.output, null, 2)}</pre>}
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </PageContainer>
  );
}

function StepBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    SUCCEEDED: "bg-success-soft text-success-text",
    FAILED: "bg-danger-soft text-danger-text",
    DENIED: "bg-danger-soft text-danger-text",
    RUNNING: "bg-brand-soft text-brand-hover",
    WAITING: "bg-info-soft text-info-text",
    AWAITING_APPROVAL: "bg-warning-soft text-warning-text",
    CANCELLED: "bg-surface-2 text-text-muted",
    SKIPPED: "bg-surface-2 text-text-muted",
    PENDING: "bg-surface-2 text-text-muted",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${map[status] ?? ""}`}>{status.toLowerCase().replace("_", " ")}</span>;
}
