import { PageContainer } from "@/components/layout/page";
import { HeroSkeleton, KpiSkeleton, PanelSkeleton, TableSkeleton, WorkforceSkeleton } from "@/components/dashboard/skeletons";

export default function DashboardLoading() {
  return (
    <PageContainer className="grid gap-5 lg:gap-6">
      <HeroSkeleton />
      <KpiSkeleton />
      <div className="grid gap-5 lg:gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <WorkforceSkeleton />
        <PanelSkeleton label="Loading items that need attention" />
      </div>
      <div className="grid gap-5 lg:gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <PanelSkeleton rows={5} label="Loading live work" />
        <PanelSkeleton rows={5} label="Loading company health" />
      </div>
      <TableSkeleton />
    </PageContainer>
  );
}
