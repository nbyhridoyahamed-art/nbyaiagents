"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { WorkflowEditorProps } from "@/components/workflows/editor-types";

// React Flow is heavy and browser-only: load it just for the builder (spec §134).
const WorkflowEditor = dynamic(() => import("@/components/workflows/workflow-editor").then((m) => m.WorkflowEditor), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100dvh-72px)] items-center justify-center text-text-muted">
      <Loader2 className="mr-2 size-5 animate-spin" aria-hidden /> Loading workflow builder…
    </div>
  ),
});

export function WorkflowEditorLoader(props: WorkflowEditorProps) {
  return <WorkflowEditor {...props} />;
}
