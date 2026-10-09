import { PageContainer } from "@/components/layout/page";
import { Skeleton } from "@/components/ui/skeleton";

/** Google's reports take a moment; show the page frame straight away. */
export default function Loading() {
  return (
    <PageContainer className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="grid gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-72 max-w-full" />
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[104px] rounded-[14px]" />
        ))}
      </div>
      <Skeleton className="h-[330px] rounded-[14px]" />
    </PageContainer>
  );
}
