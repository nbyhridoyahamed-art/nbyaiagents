"use server";

import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireOrgContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import type { AIMessage } from "@/lib/ai/types";
import { queueAgentRun, cancelAgentRun } from "@/server/runtime/agent-runtime";

const sendSchema = z.object({
  agentId: z.string().min(1).max(40),
  conversationId: z.string().max(40).nullable().optional(),
  text: z.string().trim().min(1, "Type a message.").max(8000),
});

export async function sendChatMessageAction(input: z.input<typeof sendSchema>): Promise<ActionResult<{ conversationId: string; runId: string }>> {
  return runAction(sendSchema, input, async ({ agentId, conversationId, text }) => {
    const ctx = await requireOrgContext("agents:chat");
    await enforceRateLimit("agentRun", `${ctx.org.id}:${ctx.user.id}`);
    const agent = await prisma.agent.findFirst({ where: { id: agentId, orgId: ctx.org.id, deletedAt: null } });
    if (!agent) throw new AppError("NOT_FOUND", "AI employee not found.");
    if (agent.status === "PAUSED") throw new AppError("VALIDATION", `${agent.name} is paused. Resume them to chat.`);

    let convo = conversationId
      ? await prisma.conversation.findFirst({ where: { id: conversationId, orgId: ctx.org.id, agentId, userId: ctx.user.id } })
      : null;
    if (conversationId && !convo) throw new AppError("NOT_FOUND", "Conversation not found.");
    if (!convo) {
      convo = await prisma.conversation.create({ data: { orgId: ctx.org.id, agentId, userId: ctx.user.id, title: text.slice(0, 80) } });
    }
    const active = await prisma.agentRun.count({ where: { conversationId: convo.id, status: { in: ["QUEUED", "RUNNING", "AWAITING_APPROVAL", "WAITING"] } } });
    if (active) throw new AppError("CONFLICT", `${agent.name} is still working on your previous message.`);

    // Short-term memory: recent turns of this conversation.
    const previous = await prisma.message.findMany({
      where: { conversationId: convo.id, role: { in: ["USER", "AGENT"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const history: AIMessage[] = previous
      .reverse()
      .filter((m) => m.content.trim())
      .map((m) => ({ role: m.role === "USER" ? "user" : "assistant", content: [{ type: "text", text: m.content }] }));

    await prisma.message.create({ data: { orgId: ctx.org.id, conversationId: convo.id, role: "USER", content: text } });
    await prisma.conversation.update({ where: { id: convo.id }, data: { lastMessageAt: new Date() } });

    const published = agent.lifecycle === "PUBLISHED";
    const run = await queueAgentRun(ctx.org.id, agentId, {
      input: text,
      // Draft employees are in test mode: every external action is simulated.
      mode: published ? "LIVE" : "SIMULATION",
      useDraft: !published,
      conversationId: convo.id,
      history,
    });
    return { conversationId: convo.id, runId: run.id };
  });
}

export async function cancelChatRunAction(runId: string): Promise<ActionResult> {
  return runAction(z.string().min(1), runId, async (id) => {
    const ctx = await requireOrgContext("agents:chat");
    const run = await prisma.agentRun.findFirst({ where: { id, orgId: ctx.org.id } });
    if (!run) throw new AppError("NOT_FOUND", "Run not found.");
    await cancelAgentRun(ctx.org.id, id);
  });
}

export async function deleteConversationAction(conversationId: string): Promise<ActionResult> {
  return runAction(z.string().min(1), conversationId, async (id) => {
    const ctx = await requireOrgContext("agents:chat");
    const convo = await prisma.conversation.findFirst({ where: { id, orgId: ctx.org.id, userId: ctx.user.id } });
    if (!convo) throw new AppError("NOT_FOUND", "Conversation not found.");
    await prisma.conversation.delete({ where: { id } });
  });
}
