"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertOctagon, FlaskConical, Hand, HelpCircle, Loader2, MessageSquareReply, RotateCw, Send, TextCursorInput, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/common/confirm-button";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import type { ApprovalCard as Card } from "@/server/services/approval-queries";
import { answerRequestAction, dismissRequestAction } from "@/app/(app)/approvals/actions";
import { takeOverTaskAction } from "@/app/(app)/tasks/actions";
import { rerunWorkflowAction } from "@/app/(app)/workflows/actions";
import { ContextLinks } from "./approval-card";

const KIND_META = {
  QUESTION: { label: "Question", icon: HelpCircle, tone: "text-info-text bg-info-soft" },
  INPUT_REQUEST: { label: "Input needed", icon: TextCursorInput, tone: "text-info-text bg-info-soft" },
  ESCALATION: { label: "Escalation", icon: AlertOctagon, tone: "text-warning-text bg-warning-soft" },
} as const;

export function RequestCard({ card, canDecide, canTakeOver, canRun }: { card: Card; canDecide: boolean; canTakeOver: boolean; canRun: boolean }) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const answerAction = useAction(answerRequestAction, { success: "Answer sent. The work continues." });
  const dismiss = useAction(dismissRequestAction, { success: card.isNotice ? "Marked as resolved." : "Dismissed. The paused work was stopped." });
  const takeOver = useAction(takeOverTaskAction, { success: "You've taken over the task.", refresh: false, onSuccess: () => card.task && router.push(`/tasks/${card.task.id}`) });
  const rerun = useAction(rerunWorkflowAction, { refresh: false, success: "Started a new run.", onSuccess: (d) => router.push(`/workflows/runs/${d.runId}`) });
  const pending = card.status === "PENDING";
  const meta = card.isNotice ? { label: "Workflow stopped", icon: Workflow, tone: "text-danger-text bg-danger-soft" } : KIND_META[card.kind as keyof typeof KIND_META];
  const Icon = meta?.icon ?? HelpCircle;
  const who = card.agent?.name ?? (card.workflowRun ? `Workflow “${card.workflowRun.workflowName}”` : "An employee");
  const busy = answerAction.pending || dismiss.pending || takeOver.pending || rerun.pending;
  const headline = card.isNotice
    ? card.title
    : card.kind === "QUESTION"
      ? `${who} has a question`
      : card.kind === "INPUT_REQUEST"
        ? `${who} needs information from you`
        : `${who} escalated to you`;

  return (
    <article id={`request-${card.id}`} className="scroll-mt-24 rounded-xl border bg-surface shadow-card" aria-labelledby={`request-title-${card.id}`}>
      <header className="flex flex-wrap items-start gap-3 px-5 pt-4">
        {card.agent ? (
          <AgentAvatar name={card.agent.name} color={card.agent.avatarColor} size={40} />
        ) : (
          <span className={cn("flex size-10 items-center justify-center rounded-full", meta?.tone)}>
            <Icon className="size-5" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", meta?.tone)}>
            <Icon className="size-3" aria-hidden /> {meta?.label}
          </p>
          <h3 id={`request-title-${card.id}`} className="mt-1 text-[15px] font-semibold">
            {headline}
          </h3>
          <p className="mt-0.5 text-[12.5px] text-text-muted">
            {card.agent?.jobTitle ? `${card.agent.jobTitle} · ` : ""}
            {formatDistanceToNow(new Date(card.createdAt), { addSuffix: true })}
          </p>
        </div>
        {card.isSimulation && (
          <span className="inline-flex items-center gap-1 rounded-md bg-ai-soft px-1.5 py-0.5 text-[11px] font-semibold text-ai">
            <FlaskConical className="size-3" aria-hidden /> Test run
          </span>
        )}
      </header>

      <div className="grid gap-4 px-5 py-4">
        {!card.isNotice && card.title && card.title !== card.question && <p className="text-[13.5px] font-medium">{card.title}</p>}
        {card.question && <p className="whitespace-pre-wrap rounded-lg bg-surface-2 px-4 py-3 text-[13.5px] leading-relaxed">{card.question}</p>}
        {card.task?.assigneeUserId && <p className="text-[12.5px] text-text-secondary">This task has been taken over by a person.</p>}
        <ContextLinks card={card} />

        {!pending && (
          <div className="rounded-lg border px-4 py-3 text-[13px]">
            <p className="text-xs text-text-muted">
              {card.status === "ANSWERED" ? `Answered by ${card.decidedBy ?? "a teammate"}` : card.status === "CANCELLED" ? (card.isNotice ? "Resolved" : "Dismissed") : card.status.toLowerCase()}
              {card.decidedAt && ` · ${formatDistanceToNow(new Date(card.decidedAt), { addSuffix: true })}`}
            </p>
            {card.response && <p className="mt-1 whitespace-pre-wrap">{card.response}</p>}
            {card.decisionNote && <p className="mt-1 italic text-text-secondary">{card.decisionNote}</p>}
          </div>
        )}

        {pending && canDecide && !card.isNotice && (
          <form
            className="grid gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void answerAction.run({ approvalId: card.id, answer }).then((r) => r.ok && setAnswer(""));
            }}
          >
            <Label htmlFor={`answer-${card.id}`} className="text-[13px]">
              {card.kind === "ESCALATION" ? "Guidance for the employee" : "Your answer"}
            </Label>
            <Textarea
              id={`answer-${card.id}`}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={card.kind === "ESCALATION" ? "Explain how to proceed, or take over the task below." : "Type your answer…"}
              maxLength={5000}
              aria-invalid={!!answerAction.fieldErrors.answer}
            />
            {answerAction.fieldErrors.answer && <p className="text-xs text-danger-text">{answerAction.fieldErrors.answer}</p>}
            <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
              <ConfirmButton
                variant="ghost"
                title="Dismiss this request?"
                description="The paused work stops without an answer. The employee will report back that it couldn't continue."
                confirmLabel="Dismiss"
                onConfirm={() => dismiss.run(card.id)}
                disabled={busy}
              >
                Dismiss
              </ConfirmButton>
              {card.task && !card.task.assigneeUserId && canTakeOver && (
                <ConfirmButton
                  variant="outline"
                  title="Take over this task?"
                  description="The employee stops working on it and you become responsible for finishing it. You can hand it back later with guidance."
                  confirmLabel="Take over"
                  onConfirm={() => takeOver.run({ taskId: card.task!.id })}
                  disabled={busy}
                >
                  <Hand aria-hidden /> Take over
                </ConfirmButton>
              )}
              <Button type="submit" disabled={busy || !answer.trim()}>
                {answerAction.pending ? <Loader2 className="animate-spin" aria-hidden /> : card.kind === "ESCALATION" ? <MessageSquareReply aria-hidden /> : <Send aria-hidden />}
                {card.kind === "ESCALATION" ? "Send guidance" : "Send answer"}
              </Button>
            </div>
          </form>
        )}

        {pending && canDecide && card.isNotice && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {card.workflowRun && (
              <Button asChild variant="outline">
                <Link href={`/workflows/runs/${card.workflowRun.id}`}>Inspect run</Link>
              </Button>
            )}
            {card.workflowRun && canRun && (
              <Button variant="outline" onClick={() => void rerun.run(card.workflowRun!.id)} disabled={busy}>
                {rerun.pending ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />} Run again
              </Button>
            )}
            <Button onClick={() => void dismiss.run(card.id)} disabled={busy}>
              Mark resolved
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
