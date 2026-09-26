import { Skeleton } from "@/components/ui/skeleton";

/** Loading skeletons for each dashboard section (spec §98). */

export function HeroSkeleton() {
  return (
    <div className="rounded-[20px] border bg-surface px-6 py-7 shadow-card md:px-8" style={{ minHeight: 180 }} aria-busy="true" aria-label="Loading company overview">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-4 h-8 w-80 max-w-full" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <Skeleton className="mt-6 h-9 w-36" />
    </div>
  );
}

export function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4" aria-busy="true" aria-label="Loading key numbers">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex h-[128px] flex-col justify-between rounded-[14px] border bg-surface p-5 shadow-card">
          <Skeleton className="h-3.5 w-24" />
          <div>
            <Skeleton className="h-7 w-12" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function WorkforceSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4" aria-busy="true" aria-label="Loading AI workforce">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="min-h-[220px] rounded-[14px] border bg-surface p-[18px] shadow-card">
          <div className="flex gap-3">
            <Skeleton className="size-11 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-2 h-3 w-32" />
            </div>
          </div>
          <Skeleton className="mt-5 h-4 w-full" />
          <Skeleton className="mt-3 h-1.5 w-full" />
          <Skeleton className="mt-8 h-3 w-40" />
        </div>
      ))}
    </div>
  );
}

export function PanelSkeleton({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div className="h-full rounded-[14px] border bg-surface p-5 shadow-card" aria-busy="true" aria-label={label}>
      <Skeleton className="h-3 w-36" />
      <div className="mt-5 grid gap-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div className="rounded-[14px] border bg-surface p-5 shadow-card" aria-busy="true" aria-label="Loading workflow performance">
      <Skeleton className="h-4 w-44" />
      <div className="mt-5 grid gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}
