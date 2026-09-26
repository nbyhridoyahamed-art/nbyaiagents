"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireOrgContext } from "@/lib/auth/context";
import { answerQuestion, decideApproval, dismissRequest } from "@/server/services/approvals";
import { prisma } from "@/lib/db";

function refresh() {
  revalidatePath("/approvals");
  revalidatePath("/inbox");
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const decideSchema = z.object({
  approvalId: z.string().min(1).max(40),
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(1000).optional(),
  editedInput: z.record(z.string(), z.unknown()).nullable().optional(),
});

export async function decideApprovalAction(input: z.input<typeof decideSchema>): Promise<ActionResult<{ edited: boolean }>> {
  return runAction(decideSchema, input, async ({ approvalId, decision, note, editedInput }) => {
    const ctx = await requireOrgContext("approvals:decide");
    // Only treat it as an edit when something actually changed.
    let edited: Record<string, unknown> | null = null;
    if (decision === "APPROVED" && editedInput) {
      const current = await prisma.approval.findFirst({ where: { id: approvalId, orgId: ctx.org.id }, select: { proposedInput: true } });
      const merged = { ...((current?.proposedInput as Record<string, unknown> | null) ?? {}), ...editedInput };
      if (!sameJson(merged, current?.proposedInput)) edited = merged;
    }
    await decideApproval({ orgId: ctx.org.id, userId: ctx.user.id, type: "USER" }, approvalId, decision, { note, editedInput: edited });
    refresh();
    return { edited: !!edited };
  });
}

const answerSchema = z.object({
  approvalId: z.string().min(1).max(40),
  answer: z.string().trim().min(1, "Write an answer.").max(5000),
});

export async function answerRequestAction(input: z.input<typeof answerSchema>): Promise<ActionResult> {
  return runAction(answerSchema, input, async ({ approvalId, answer }) => {
    const ctx = await requireOrgContext("approvals:decide");
    await answerQuestion({ orgId: ctx.org.id, userId: ctx.user.id, type: "USER" }, approvalId, answer);
    refresh();
  });
}

export async function dismissRequestAction(approvalId: string): Promise<ActionResult> {
  return runAction(z.string().min(1).max(40), approvalId, async (id) => {
    const ctx = await requireOrgContext("approvals:decide");
    await dismissRequest({ orgId: ctx.org.id, userId: ctx.user.id, type: "USER" }, id);
    refresh();
  });
}
