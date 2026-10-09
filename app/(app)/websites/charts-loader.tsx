"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// Charts load after the numbers, like the Analytics page.
const loading = () => <Skeleton className="h-[260px] w-full rounded-lg" />;
export const SearchTrendChart = dynamic(() => import("@/components/websites/charts").then((m) => m.SearchTrendChart), { ssr: false, loading });
export const TrafficTrendChart = dynamic(() => import("@/components/websites/charts").then((m) => m.TrafficTrendChart), { ssr: false, loading });
