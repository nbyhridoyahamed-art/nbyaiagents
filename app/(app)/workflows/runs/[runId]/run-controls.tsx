"use client";

import { useRouter } from "next/navigation";
import { RotateCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/common/confirm-button";
import { useAction } from "@/hooks/use-action";
import { cancelWorkflowRunAction, rerunWorkflowAction } from "../../actions";

export function RunControls({ runId, status }: { runId: string; status: string }) {
  const router = useRouter();
  const cancel = useAction(cancelWorkflowRunAction, { success: "Cancelling…" });
  const rerun = useAction(rerunWorkflowAction, { refresh: false, success: "Started a new run.", onSuccess: (d) => router.push(`/workflows/runs/${d.runId}`) });
  const active = ["QUEUED", "RUNNING", "WAITING", "AWAITING_APPROVAL"].includes(status);
  return (
    <div className="flex gap-2">
      {active ? (
        <ConfirmButton variant="outline" title="Cancel this run?" description="The workflow stops at the next safe point. Pending approvals and employee work for it are cancelled." confirmLabel="Cancel run" onConfirm={() => cancel.run(runId)}>
          <Square aria-hidden /> Cancel
        </ConfirmButton>
      ) : (
        <Button variant="outline" onClick={() => void rerun.run(runId)} disabled={rerun.pending}>
          <RotateCw aria-hidden /> Run again
        </Button>
      )}
    </div>
  );
}
