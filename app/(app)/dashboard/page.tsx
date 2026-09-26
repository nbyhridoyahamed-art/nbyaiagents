import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePageContext } from "@/lib/auth/context";
import { PageContainer } from "@/components/layout/page";
import { HeroSkeleton, KpiSkeleton, PanelSkeleton, TableSkeleton, WorkforceSkeleton } from "@/components/dashboard/skeletons";
import {
  ActivitySection,
  AttentionSection,
  HealthSection,
  HeroSection,
  KnowledgeNudge,
  KpiSection,
  LiveWorkSection,
  WorkflowSection,
  WorkforceSection,
  type DashboardCtx,
} from "./sections";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * AI Company Command Center (spec §62–106): who is working, what they're doing,
 * what needs attention, what's done and whether the company is healthy.
 * Sections stream independently and fail independently.
 */
export default async function DashboardPage() {
  const ctx = await requirePageContext();
  const d: DashboardCtx = {
    orgId: ctx.org.id,
    timeZone: ctx.org.timezone,
    isDemo: ctx.org.isDemo,
    can: { hire: ctx.can("agents:write"), workflows: ctx.can("workflows:write"), knowledge: ctx.can("knowledge:write"), budget: ctx.can("org:manage") },
  };

  return (
    <PageContainer className="grid gap-5 lg:gap-6">
      <Suspense fallback={<HeroSkeleton />}>
        <HeroSection ctx={d} />
      </Suspense>
      <Suspense fallback={<KpiSkeleton />}>
        <KpiSection ctx={d} />
      </Suspense>
      <Suspense fallback={null}>
        <KnowledgeNudge ctx={d} />
      </Suspense>

      <div className="grid gap-5 lg:gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Suspense fallback={<WorkforceSkeleton />}>
          <WorkforceSection ctx={d} />
        </Suspense>
        <div className="xl:pt-[52px]">
          <Suspense fallback={<PanelSkeleton label="Loading items that need attention" />}>
            <AttentionSection ctx={d} />
          </Suspense>
        </div>
      </div>

      <div className="grid gap-5 lg:gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Suspense fallback={<PanelSkeleton rows={5} label="Loading live work" />}>
          <LiveWorkSection ctx={d} />
        </Suspense>
        <Suspense fallback={<PanelSkeleton rows={5} label="Loading company health" />}>
          <HealthSection ctx={d} />
        </Suspense>
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <WorkflowSection ctx={d} />
      </Suspense>
      <Suspense fallback={<PanelSkeleton rows={6} label="Loading company activity" />}>
        <ActivitySection ctx={d} />
      </Suspense>
    </PageContainer>
  );
}
