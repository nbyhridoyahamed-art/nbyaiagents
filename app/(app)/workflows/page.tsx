import type { Metadata } from "next";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Plus, Workflow as WorkflowIcon } from "lucide-react";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { WorkflowStatusBadge } from "@/components/workflows/workflow-status";

export const metadata: Metadata = { title: "Workflows" };

export default async function WorkflowsPage(props: PageProps<"/workflows">) {
  const ctx = await requirePageContext("workflows:read");
  // ?run=1 (command palette "Run Workflow"): pick an active workflow to run.
  const runMode = (await props.searchParams).run === "1" && ctx.can("workflows:run");
  const workflows = await prisma.workflow.findMany({
    where: { orgId: ctx.org.id, deletedAt: null },
    include: { department: { select: { name: true } }, agents: { include: { agent: { select: { name: true } } } } },
    orderBy: { updatedAt: "desc" },
  });
  const ids = workflows.map((w) => w.id);
  const [runCounts, lastRuns] = await Promise.all([
    prisma.workflowRun.groupBy({ by: ["workflowId", "status"], where: { workflowId: { in: ids }, mode: "LIVE" }, _count: true }),
    prisma.workflowRun.findMany({ where: { workflowId: { in: ids } }, orderBy: { createdAt: "desc" }, distinct: ["workflowId"], select: { workflowId: true, createdAt: true, status: true } }),
  ]);
  const canWrite = ctx.can("workflows:write");

  return (
    <PageContainer>
      <PageHeader
        title="Workflows"
        description="Turn repetitive work into automation. Workflows run in the background, pause for approvals, and never depend on this page staying open."
        actions={
          canWrite && (
            <Button asChild size="lg">
              <Link href="/workflows/new">
                <Plus aria-hidden /> Create Workflow
              </Link>
            </Button>
          )
        }
      />
      {runMode && workflows.length > 0 && (
        <p className="mb-4 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-[13.5px] text-brand-hover" role="status">
          Choose a workflow to run. Only active (published) workflows can run live — others open in the builder.
        </p>
      )}
      {workflows.length === 0 ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No workflows are active yet."
          description="Turn repetitive work into automation."
          action={
            canWrite && (
              <Button asChild size="lg">
                <Link href="/workflows/new">Create Workflow</Link>
              </Button>
            )
          }
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-surface shadow-card">
          {workflows.map((w) => {
            const counts = runCounts.filter((r) => r.workflowId === w.id);
            const total = counts.reduce((s, c) => s + c._count, 0);
            const ok = counts.find((c) => c.status === "COMPLETED")?._count ?? 0;
            const failed = counts.find((c) => c.status === "FAILED")?._count ?? 0;
            const last = lastRuns.find((r) => r.workflowId === w.id);
            return (
              <li key={w.id}>
                <Link
                  href={runMode && w.status === "ACTIVE" ? `/workflows/${w.id}?run=1` : `/workflows/${w.id}`}
                  className={`flex flex-col gap-2 p-4 hover:bg-surface-2 md:flex-row md:items-center ${runMode && w.status !== "ACTIVE" ? "opacity-60" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
                      {w.name} <WorkflowStatusBadge status={w.status} />
                    </p>
                    <p className="truncate text-xs text-text-muted">
                      {w.triggerType.toLowerCase()} trigger
                      {w.department ? ` · ${w.department.name}` : ""}
                      {w.agents.length ? ` · ${w.agents.map((a) => a.agent.name).join(", ")}` : ""}
                      {w.publishedVersion ? ` · v${w.publishedVersion} live` : " · not published"}
                      {w.draftVersion > (w.publishedVersion ?? 0) && w.publishedVersion ? ` · draft v${w.draftVersion}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-5 text-xs text-text-secondary">
                    <span>
                      <span className="font-semibold tabular-nums text-foreground">{total}</span> runs
                    </span>
                    <span>
                      <span className="font-semibold tabular-nums text-foreground">{ok + failed ? `${Math.round((ok / (ok + failed)) * 100)}%` : "—"}</span> success
                    </span>
                    <span>{last ? `Last run ${formatDistanceToNow(last.createdAt, { addSuffix: true })}` : "Never run"}</span>
                    {runMode && <span className="font-semibold text-brand">{w.status === "ACTIVE" ? "Run →" : "Not active"}</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageContainer>
  );
}
