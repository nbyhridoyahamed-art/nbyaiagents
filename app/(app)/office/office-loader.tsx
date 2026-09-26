"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { OfficeData } from "@/server/services/office";

// React Flow is browser-only and heavy — it's loaded here, never on the dashboard (spec §63).
const OfficeView = dynamic(() => import("@/components/office/office-view").then((m) => m.OfficeView), {
  ssr: false,
  loading: () => (
    <div className="flex h-[560px] items-center justify-center rounded-[20px] border bg-surface text-text-muted">
      <Loader2 className="mr-2 size-5 animate-spin" aria-hidden /> Opening the office…
    </div>
  ),
});

export function OfficeLoader({ data }: { data: OfficeData }) {
  return <OfficeView data={data} />;
}
