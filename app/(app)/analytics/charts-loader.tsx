"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// Charts are lazy-loaded (spec §134): the page renders its numbers first.
const loading = () => <Skeleton className="h-[240px] w-full rounded-lg" />;
export const ExecutionsChart = dynamic(() => import("@/components/analytics/charts").then((m) => m.ExecutionsChart), { ssr: false, loading });
export const CostChart = dynamic(() => import("@/components/analytics/charts").then((m) => m.CostChart), { ssr: false, loading });
