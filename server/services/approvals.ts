import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ApprovalKind, RiskLevel } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/lib/auth/actor";
import { redact } from "@/lib/security/redact";
import { enqueue } from "@/server/jobs/queue";
import { recordActivity, writeAudit } from "@/server/services/audit";
import { notifyMembers } from "@/server/services/notifications";

export interface CreateApprovalInput {
  orgId: string;
  kind: ApprovalKind;
  title: string;
  summary?: string;
  agentId?: string | null;
  taskId?: string | null;
  agentRunId?: string | null;
  workflowRunId?: string | null;
  workflowStepId?: string | null;
  toolKey?: string | null;
  toolName?: string | null;
  riskLevel?: RiskLevel | null;
  proposedInput?: Record<string, unknown> | null;
  reasons?: string[];
  question?: string | null;
  isSimulation?: boolean;
}

export async function createApproval(input: CreateApprovalInput) {
  const approval = await prisma.approval.create({
    data: {
      ...input,
      proposedInput: (input.proposedInput ?? undefined) as Prisma.InputJsonValue | undefined,
      reasons: input.reasons ?? [],
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  const agent = input.agentId ? await prisma.agent.findUnique({ where: { id: input.agentId }, select: { name: true } }) : null;
  const who = agent?.name ?? "A workflow";
  const isQuestion = input.kind === "QUESTION" || input.kind === "INPUT_REQUEST" || input.kind === "ESCALATION";
  await notifyMembers(input.orgId, "approvals:decide", {
    type: isQuestion ? "question" : "approval",
    title: isQuestion ? `${who} needs your input` : `Approval requested by ${who}`,
    body: input.title,
    link: isQuestion ? "/inbox" : `/approvals?focus=${approval.id}`,
    email: isQuestion ? "agent_escalation" : "approval_request",
  });
  await recordActivity({
    orgId: input.orgId,
    category: "APPROVAL",
    actorType: input.agentId ? "AGENT" : "SYSTEM",
    actorAgentId: input.agentId ?? null,
    summary: isQuestion ? `${who} asked for input.` : `${who} requested approval.`,
    detail: input.title,
    entityType: "Approval",
    entityId: approval.id,
    link: isQuestion ? "/inbox" : "/approvals",
    isSimulation: input.isSimulation ?? false,
  });
  return approval;
}

async function continueWork(approval: { id: string; orgId: string; agentRunId: string | null; workflowRunId: string | null }) {
  // The workflow owns runs it started; otherwise resume the agent run directly.
  if (approval.workflowRunId && !approval.agentRunId) {
    await enqueue("workflow.advance", { workflowRunId: approval.workflowRunId, approvalId: approval.id }, { orgId: approval.orgId, dedupeKey: `wf-approval:${approval.id}` });
  } else if (approval.agentRunId) {
    await enqueue("agent.resume", { runId: approval.agentRunId, approvalId: approval.id }, { orgId: approval.orgId, dedupeKey: `run-approval:${approval.id}` });
  }
}

/**
 * Human decision on an action approval. `editedInput` lets the reviewer change
 * the proposed action (e.g. fix an email) — the edited version is what executes.
 */
export async function decideApproval(
  actor: Actor & { userId: string },
  approvalId: string,
  decision: "APPROVED" | "REJECTED",
  opts: { note?: string; editedInput?: Record<string, unknown> | null } = {},
) {
  const approval = await prisma.approval.findFirst({ where: { id: approvalId, orgId: actor.orgId } });
  if (!approval) throw notFound("Approval");
  if (approval.status !== "PENDING") throw new AppError("CONFLICT", `This request was already ${approval.status.toLowerCase()}.`);
  if (approval.kind !== "TOOL_ACTION" && approval.kind !== "REVIEW") throw new AppError("VALIDATION", "Answer questions from the inbox.");
  if (opts.editedInput && approval.kind !== "TOOL_ACTION" && approval.kind !== "REVIEW") throw new AppError("VALIDATION", "Only actions and reviews can be edited.");

  if (opts.editedInput && approval.toolKey) {
    // Edited input must still satisfy the tool's schema.
    const { validateToolInput } = await import("@/server/tools/validate");
    await validateToolInput(actor.orgId, approval.toolKey, opts.editedInput);
  }

  // Compare-and-set so two reviewers can't both decide.
  const updated = await prisma.approval.updateMany({
    where: { id: approval.id, status: "PENDING" },
    data: {
      status: decision,
      decidedById: actor.userId,
      decidedAt: new Date(),
      decisionNote: opts.note?.slice(0, 1000) || null,
      editedInput: (opts.editedInput ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
  if (updated.count === 0) throw new AppError("CONFLICT", "Someone else just decided this request.");

  await writeAudit({
    orgId: actor.orgId,
    actorType: "USER",
    actorUserId: actor.userId,
    action: decision === "APPROVED" ? "approval.approve" : "approval.reject",
    entityType: "Approval",
    entityId: approval.id,
    runId: approval.agentRunId ?? undefined,
    workflowRunId: approval.workflowRunId ?? undefined,
    toolKey: approval.toolKey ?? undefined,
    metadata: { edited: !!opts.editedInput, note: opts.note, input: redact(opts.editedInput ?? approval.proposedInput) },
  });
  await recordActivity({
    orgId: actor.orgId,
    category: "APPROVAL",
    actorType: "USER",
    actorUserId: actor.userId,
    actorAgentId: approval.agentId,
    summary: `${decision === "APPROVED" ? "Approved" : "Rejected"}: ${approval.title}${opts.editedInput ? " (edited)" : ""}`,
    entityType: "Approval",
    entityId: approval.id,
    isSimulation: approval.isSimulation,
  });
  await continueWork(approval);
}

/** Answer an agent question / input request / escalation from the inbox. */
export async function answerQuestion(actor: Actor & { userId: string }, approvalId: string, answer: string) {
  const approval = await prisma.approval.findFirst({ where: { id: approvalId, orgId: actor.orgId } });
  if (!approval) throw notFound("Request");
  if (approval.status !== "PENDING") throw new AppError("CONFLICT", "This request was already handled.");
  if (!["QUESTION", "INPUT_REQUEST", "ESCALATION"].includes(approval.kind)) throw new AppError("VALIDATION", "Decide actions from the approvals page.");
  const text = answer.trim();
  if (!text) throw new AppError("VALIDATION", "Write an answer.", { fieldErrors: { answer: "Write an answer." } });
  const updated = await prisma.approval.updateMany({
    where: { id: approval.id, status: "PENDING" },
    data: { status: "ANSWERED", response: text.slice(0, 5000), decidedById: actor.userId, decidedAt: new Date() },
  });
  if (updated.count === 0) throw new AppError("CONFLICT", "Someone else just answered this request.");
  await writeAudit({ orgId: actor.orgId, actorType: "USER", actorUserId: actor.userId, action: "approval.answer", entityType: "Approval", entityId: approval.id, runId: approval.agentRunId ?? undefined });
  await continueWork(approval);
}

/** Dismiss a question/escalation, cancelling the paused work. */
export async function dismissRequest(actor: Actor & { userId: string }, approvalId: string) {
  const approval = await prisma.approval.findFirst({ where: { id: approvalId, orgId: actor.orgId } });
  if (!approval) throw notFound("Request");
  if (approval.status !== "PENDING") throw new AppError("CONFLICT", "This request was already handled.");
  await prisma.approval.update({ where: { id: approval.id }, data: { status: "CANCELLED", decidedById: actor.userId, decidedAt: new Date() } });
  await writeAudit({ orgId: actor.orgId, actorType: "USER", actorUserId: actor.userId, action: "approval.dismiss", entityType: "Approval", entityId: approval.id });
  await continueWork(approval);
}
