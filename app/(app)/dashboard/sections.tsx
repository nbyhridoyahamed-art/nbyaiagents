import Link from "next/link";
import { cache } from "react";
import { BookOpen, Plus, Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { AgentCard } from "@/components/agents/agent-card";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/layout/page";
import { CompanyHero } from "@/components/dashboard/hero";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { AttentionPanel } from "@/components/dashboard/attention-panel";
import { LiveWork } from "@/components/dashboard/live-work";
import { HealthCard } from "@/components/dashboard/health-card";
import { WorkflowPerformance } from "@/components/dashboard/workflow-performance";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { Reveal } from "@/components/dashboard/reveal";
import { SectionFailed } from "@/components/dashboard/section";
import { RunLiveRefresher } from "@/app/(app)/runs/[id]/run-live-refresher";
import {
  getAttention,
  getCompanyHealth,
  getDashboardSummary,
  getLiveWork,
  getRecentActivity,
  getSetupState,
  getWorkflowPerformance,
  getWorkforce,
} from "@/server/services/dashboard";

export interface DashboardCtx {
  orgId: string;
  timeZone: string;
  isDemo: boolean;
  can: { hire: boolean; workflows: boolean; knowledge: boolean; budget: boolean };
}

// Shared by hero, KPIs and the attention panel within one request.
const summaryFor = cache((orgId: string, timeZone: string) => getDashboardSummary(orgId, timeZone));

/** Runs a section's data loader; a failure renders an inline error instead of breaking the page. */
async function load<T>(label: string, fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; label: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    console.error(`[dashboard] ${label} failed`, err);
    return { ok: false, label };
  }
}

export async function HeroSection({ ctx }: { ctx: DashboardCtx }) {
  const r = await load("Company overview", () => summaryFor(ctx.orgId, ctx.timeZone));
  if (!r.ok) return <SectionFailed label={r.label} />;
  return (
    <Reveal>
      <CompanyHero summary={r.data} isDemo={ctx.isDemo} canHire={ctx.can.hire} />
    </Reveal>
  );
}

export async function KpiSection({ ctx }: { ctx: DashboardCtx }) {
  const r = await load("Key numbers", () => summaryFor(ctx.orgId, ctx.timeZone));
  if (!r.ok) return <SectionFailed label={r.label} />;
  return <KpiGrid summary={r.data} />;
}

export async function WorkforceSection({ ctx }: { ctx: DashboardCtx }) {
  const r = await load("AI workforce", () => getWorkforce(ctx.orgId));
  if (!r.ok) return <SectionFailed label={r.label} />;
  const { agents, total } = r.data;
  return (
    <section aria-labelledby="workforce-title">
      <SectionHeader
        id="workforce-title"
        title="AI Workforce"
        description={total ? `${total} employee${total === 1 ? "" : "s"} · measured from real task results` : undefined}
        actions={
          total > agents.length && (
            <Link href="/agents" className="text-[13px] font-medium text-brand hover:underline">
              View all {total}
            </Link>
          )
        }
      />
      {agents.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No AI employees yet."
          description="Build your first digital employee and start assigning real work."
          action={
            ctx.can.hire && (
              <Button asChild>
                <Link href="/agents/new">
                  <Plus aria-hidden /> Hire AI Employee
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {agents.map((a, i) => (
            <Reveal key={a.id} index={i}>
              <AgentCard agent={a} className="h-full" />
            </Reveal>
          ))}
        </div>
      )}
    </section>
  );
}

export async function AttentionSection({ ctx }: { ctx: DashboardCtx }) {
  const r = await load("Attention items", async () => ({ items: await getAttention(ctx.orgId), summary: await summaryFor(ctx.orgId, ctx.timeZone) }));
  if (!r.ok) return <SectionFailed label={r.label} />;
  return <AttentionPanel items={r.data.items} attention={r.data.summary.attention} />;
}

export async function LiveWorkSection({ ctx }: { ctx: DashboardCtx }) {
  const r = await load("Live work", () => getLiveWork(ctx.orgId));
  if (!r.ok) return <SectionFailed label={r.label} />;
  // Poll gently only while something is actually running (and only in the foreground tab).
  const live = r.data.runs.some((x) => x.status === "RUNNING");
  return (
    <>
      {live && <RunLiveRefresher intervalMs={8000} />}
      <LiveWork {...r.data} />
    </>
  );
}

export async function HealthSection({ ctx }: { ctx: DashboardCtx }) {
  const r = await load("Company health", async () => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { monthlyAiBudgetUsd: true } });
    return getCompanyHealth(ctx.orgId, ctx.timeZone, org.monthlyAiBudgetUsd);
  });
  if (!r.ok) return <SectionFailed label={r.label} />;
  return <HealthCard health={r.data} canManageBudget={ctx.can.budget} />;
}

export async function WorkflowSection({ ctx }: { ctx: DashboardCtx }) {
  const r = await load("Workflow performance", () => getWorkflowPerformance(ctx.orgId));
  if (!r.ok) return <SectionFailed label={r.label} />;
  return <WorkflowPerformance rows={r.data} canCreate={ctx.can.workflows} />;
}

export async function ActivitySection({ ctx }: { ctx: DashboardCtx }) {
  const r = await load("Company activity", () => getRecentActivity(ctx.orgId));
  if (!r.ok) return <SectionFailed label={r.label} />;
  return <ActivityFeed items={r.data} />;
}

/** Nudge when employees exist but have nothing to learn from (spec §100). */
export async function KnowledgeNudge({ ctx }: { ctx: DashboardCtx }) {
  const r = await load("Setup", () => getSetupState(ctx.orgId));
  if (!r.ok || r.data.agents === 0 || r.data.docs > 0) return null;
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-ai/30 bg-ai-soft/50 p-4 sm:flex-row sm:items-center">
      <BookOpen className="size-5 shrink-0 text-ai" aria-hidden />
      <div className="flex-1">
        <p className="text-[14px] font-semibold">Your AI employees need knowledge.</p>
        <p className="text-[13px] text-text-secondary">Add policies, documents or product information so their answers are grounded in your business.</p>
      </div>
      {ctx.can.knowledge && (
        <Button asChild variant="outline">
          <Link href="/knowledge">
            <Plus aria-hidden /> Add Knowledge
          </Link>
        </Button>
      )}
    </div>
  );
}
