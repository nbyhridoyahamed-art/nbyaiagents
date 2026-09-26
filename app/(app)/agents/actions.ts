"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireOrgContext } from "@/lib/auth/context";
import { userActor } from "@/lib/auth/actor";
import {
  agentIdentitySchema,
  agentPersonalitySchema,
  agentRoleSchema,
  createAgentSchema,
  instructionsSchema,
  limitsSchema,
  modelConfigSchema,
  toolAssignmentSchema,
} from "@/lib/agents/schema";
import {
  archiveAgent,
  createAgent,
  duplicateAgent,
  publishAgent,
  setAgentDelegates,
  setAgentInstructions,
  setAgentKnowledge,
  setAgentStatus,
  setAgentTools,
  updateAgentProfile,
  validateAgent,
  type ValidationIssue,
} from "@/server/services/agents";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";

const id = z.string().min(1).max(40);

export async function createAgentAction(input: z.input<typeof createAgentSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(createAgentSchema, input, async (data) => {
    const ctx = await requireOrgContext("agents:write");
    const agent = await createAgent(userActor(ctx.org.id, ctx.user.id), data);
    revalidatePath("/agents");
    return { id: agent.id };
  });
}

const profileSchema = z.object({
  agentId: id,
  profile: agentIdentitySchema.partial().extend(agentRoleSchema.partial().shape).extend(agentPersonalitySchema.partial().shape),
});

export async function updateAgentProfileAction(input: z.input<typeof profileSchema>): Promise<ActionResult> {
  return runAction(profileSchema, input, async ({ agentId, profile }) => {
    const ctx = await requireOrgContext("agents:write");
    await updateAgentProfile(userActor(ctx.org.id, ctx.user.id), agentId, profile);
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function updateAgentModelAction(input: { agentId: string; model: z.input<typeof modelConfigSchema>; limits: z.input<typeof limitsSchema> }): Promise<ActionResult> {
  return runAction(z.object({ agentId: id, model: modelConfigSchema, limits: limitsSchema }), input, async ({ agentId, model, limits }) => {
    const ctx = await requireOrgContext("agents:write");
    await updateAgentProfile(userActor(ctx.org.id, ctx.user.id), agentId, { model, limits });
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function updateInstructionsAction(input: { agentId: string; instructions: z.input<typeof instructionsSchema> }): Promise<ActionResult> {
  return runAction(z.object({ agentId: id, instructions: instructionsSchema }), input, async ({ agentId, instructions }) => {
    const ctx = await requireOrgContext("agents:write");
    await setAgentInstructions(userActor(ctx.org.id, ctx.user.id), agentId, instructions);
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function updateAgentToolsAction(input: { agentId: string; tools: z.input<typeof toolAssignmentSchema>[] }): Promise<ActionResult> {
  return runAction(z.object({ agentId: id, tools: z.array(toolAssignmentSchema).max(100) }), input, async ({ agentId, tools }) => {
    // Changing what an employee may do is a permission change: admin-level for high-risk grants.
    const ctx = await requireOrgContext("agents:write");
    await setAgentTools(userActor(ctx.org.id, ctx.user.id), agentId, tools);
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function updateAgentKnowledgeAction(input: { agentId: string; knowledgeBaseIds: string[] }): Promise<ActionResult> {
  return runAction(z.object({ agentId: id, knowledgeBaseIds: z.array(id).max(50) }), input, async ({ agentId, knowledgeBaseIds }) => {
    const ctx = await requireOrgContext("agents:write");
    await setAgentKnowledge(userActor(ctx.org.id, ctx.user.id), agentId, knowledgeBaseIds);
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function updateAgentWorkflowsAction(input: { agentId: string; workflowIds: string[] }): Promise<ActionResult> {
  return runAction(z.object({ agentId: id, workflowIds: z.array(id).max(50) }), input, async ({ agentId, workflowIds }) => {
    const ctx = await requireOrgContext("agents:write");
    const count = await prisma.workflow.count({ where: { orgId: ctx.org.id, id: { in: workflowIds }, deletedAt: null } });
    if (count !== new Set(workflowIds).size) throw new AppError("VALIDATION", "One or more workflows are unavailable.");
    const agent = await prisma.agent.findFirst({ where: { id: agentId, orgId: ctx.org.id, deletedAt: null } });
    if (!agent) throw new AppError("NOT_FOUND", "AI employee not found.");
    await prisma.$transaction([
      prisma.agentWorkflow.deleteMany({ where: { agentId, workflowId: { notIn: workflowIds } } }),
      ...workflowIds.map((workflowId) =>
        prisma.agentWorkflow.upsert({ where: { agentId_workflowId: { agentId, workflowId } }, create: { agentId, workflowId }, update: {} }),
      ),
    ]);
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function updateDelegatesAction(input: { agentId: string; delegateIds: string[] }): Promise<ActionResult> {
  return runAction(z.object({ agentId: id, delegateIds: z.array(id).max(20) }), input, async ({ agentId, delegateIds }) => {
    const ctx = await requireOrgContext("agents:write");
    await setAgentDelegates(userActor(ctx.org.id, ctx.user.id), agentId, delegateIds);
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function validateAgentAction(agentId: string): Promise<ActionResult<ValidationIssue[]>> {
  return runAction(id, agentId, async (aid) => {
    const ctx = await requireOrgContext("agents:read");
    return validateAgent(ctx.org.id, aid);
  });
}

export async function publishAgentAction(input: { agentId: string; notes?: string }): Promise<ActionResult<{ version: number }>> {
  return runAction(z.object({ agentId: id, notes: z.string().max(500).optional() }), input, async ({ agentId, notes }) => {
    const ctx = await requireOrgContext("agents:publish");
    const { version } = await publishAgent(userActor(ctx.org.id, ctx.user.id), agentId, notes);
    revalidatePath(`/agents/${agentId}`);
    revalidatePath("/agents");
    return { version };
  });
}

export async function setAgentPausedAction(input: { agentId: string; paused: boolean }): Promise<ActionResult> {
  return runAction(z.object({ agentId: id, paused: z.boolean() }), input, async ({ agentId, paused }) => {
    const ctx = await requireOrgContext("agents:write");
    await setAgentStatus(userActor(ctx.org.id, ctx.user.id), agentId, paused ? "PAUSED" : "ACTIVE");
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function duplicateAgentAction(agentId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(id, agentId, async (aid) => {
    const ctx = await requireOrgContext("agents:write");
    const copy = await duplicateAgent(userActor(ctx.org.id, ctx.user.id), aid);
    revalidatePath("/agents");
    return { id: copy.id };
  });
}

export async function deleteAgentAction(agentId: string): Promise<ActionResult> {
  return runAction(id, agentId, async (aid) => {
    const ctx = await requireOrgContext("agents:write");
    await archiveAgent(userActor(ctx.org.id, ctx.user.id), aid);
    revalidatePath("/agents");
  });
}

export async function generateAgentDraftAction(description: string): Promise<ActionResult<import("@/server/services/agent-generator").GeneratedDraft>> {
  return runAction(z.string().trim().min(15, "Describe the role in at least a sentence.").max(3000), description, async (text) => {
    const ctx = await requireOrgContext("agents:write");
    const { enforceRateLimit } = await import("@/lib/security/rate-limit");
    await enforceRateLimit("aiRequest", `${ctx.org.id}:${ctx.user.id}`);
    const { generateAgentDraft } = await import("@/server/services/agent-generator");
    return generateAgentDraft(ctx.org.id, text);
  });
}
