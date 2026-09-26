"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Hand, Loader2, Play, RotateCw, Square, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/common/confirm-button";
import { useAction } from "@/hooks/use-action";
import type { TaskStatus } from "@/lib/generated/prisma/enums";
import { cancelTaskAction, completeTaskManuallyAction, deleteTaskAction, handBackTaskAction, runTaskAction, takeOverTaskAction } from "../actions";

export function TaskActions({
  taskId,
  status,
  hasAgent,
  hasActiveRun,
  takenOver,
}: {
  taskId: string;
  status: TaskStatus;
  hasAgent: boolean;
  hasActiveRun: boolean;
  takenOver: boolean;
}) {
  const router = useRouter();
  const run = useAction(runTaskAction, { success: "Work started." });
  const cancel = useAction(cancelTaskAction, { success: "Task cancelled." });
  const takeOver = useAction(takeOverTaskAction, { success: "You've taken over this task." });
  const del = useAction(deleteTaskAction, { refresh: false, success: "Task deleted.", onSuccess: () => router.push("/tasks") });
  const finished = status === "COMPLETED" || status === "CANCELLED";
  return (
    <div className="flex flex-wrap gap-2">
      {!hasActiveRun && !takenOver && hasAgent && status !== "CANCELLED" && (
        <Button onClick={() => void run.run(taskId)} disabled={run.pending}>
          {status === "QUEUED" ? <Play aria-hidden /> : <RotateCw aria-hidden />}
          {status === "QUEUED" ? "Start" : "Run again"}
        </Button>
      )}
      {!finished && !takenOver && hasAgent && (
        <ConfirmButton
          variant="outline"
          title="Take over this task?"
          description="The employee stops working on it — any pending approvals are cancelled — and you become responsible for finishing it. You can hand it back later with guidance."
          confirmLabel="Take over"
          onConfirm={() => takeOver.run({ taskId })}
        >
          <Hand aria-hidden /> Take over
        </ConfirmButton>
      )}
      {!finished && (hasActiveRun || takenOver || status !== "QUEUED") && (
        <ConfirmButton variant="outline" title="Cancel this task?" description="Any work in progress stops at the next safe point. Pending approvals for it are cancelled." confirmLabel="Cancel task" onConfirm={() => cancel.run(taskId)}>
          <Square aria-hidden /> Cancel
        </ConfirmButton>
      )}
      <ConfirmButton variant="ghost" destructive title="Delete this task?" description="Its history stays in the audit log." confirmLabel="Delete" onConfirm={() => del.run(taskId)}>
        <Trash2 aria-hidden />
        <span className="sr-only">Delete task</span>
      </ConfirmButton>
    </div>
  );
}

/** Shown to the person who took a task over: finish it themselves or hand it back. */
export function TakeoverPanel({ taskId, agentName, canHandBack }: { taskId: string; agentName: string | null; canHandBack: boolean }) {
  const [mode, setMode] = useState<"complete" | "handback">("complete");
  const [text, setText] = useState("");
  const complete = useAction(completeTaskManuallyAction, { success: "Task completed." });
  const handBack = useAction(handBackTaskAction, { success: `Handed back to ${agentName ?? "the employee"}.` });
  const busy = complete.pending || handBack.pending;
  const errors = mode === "complete" ? complete.fieldErrors.result : undefined;
  return (
    <section className="rounded-xl border border-warning/40 bg-surface p-5 shadow-card" aria-labelledby="takeover-title">
      <h2 id="takeover-title" className="flex items-center gap-2 text-card-title">
        <Hand className="size-4 text-warning-text" aria-hidden /> You took over this task
      </h2>
      <p className="mt-1 text-[13px] text-text-secondary">
        {agentName ? `${agentName} has stopped working on it.` : "The employee has stopped working on it."} Record the outcome when you&apos;re done, or hand it back with guidance.
      </p>
      <div className="mt-4 flex gap-1.5" role="tablist" aria-label="Takeover options">
        {(["complete", ...(canHandBack ? ["handback"] : [])] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m as "complete" | "handback")}
            className={`rounded-full px-3 py-1 text-[12.5px] font-medium ${mode === m ? "bg-foreground text-background" : "text-text-secondary hover:bg-surface-2"}`}
          >
            {m === "complete" ? "Complete it myself" : `Hand back to ${agentName ?? "employee"}`}
          </button>
        ))}
      </div>
      <form
        className="mt-3 grid gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const p = mode === "complete" ? complete.run({ taskId, result: text }) : handBack.run({ taskId, guidance: text || undefined });
          void p.then((r) => r.ok && setText(""));
        }}
      >
        <Label htmlFor="takeover-text" className="text-[13px]">
          {mode === "complete" ? "Outcome" : "Guidance (optional)"}
        </Label>
        <Textarea
          id="takeover-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === "complete" ? "What was done? This becomes the task result." : "e.g. Use the enterprise pricing sheet, and CC me on the email."}
          aria-invalid={!!errors}
        />
        {errors && <p className="text-xs text-danger-text">{errors}</p>}
        <div className="mt-1 flex justify-end">
          <Button type="submit" disabled={busy || (mode === "complete" && !text.trim())}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : mode === "complete" ? <CheckCircle2 aria-hidden /> : <Undo2 aria-hidden />}
            {mode === "complete" ? "Mark complete" : "Hand back & restart"}
          </Button>
        </div>
      </form>
    </section>
  );
}
