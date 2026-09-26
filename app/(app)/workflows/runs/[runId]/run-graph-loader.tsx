"use client";

import dynamic from "next/dynamic";
import type { WorkflowGraph } from "@/lib/workflows/types";

const RunGraph = dynamic(() => import("@/components/workflows/run-graph").then((m) => m.RunGraph), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-[13px] text-text-muted">Loading graph…</div>,
});

export function RunGraphLoader(props: { graph: WorkflowGraph; statuses: Record<string, string> }) {
  return <RunGraph {...props} />;
}
