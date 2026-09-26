"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireOrgContext } from "@/lib/auth/context";
import { userActor } from "@/lib/auth/actor";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import type { GraphIssue } from "@/lib/workflows/validate-graph";
import {
  archiveWorkflow,
  createWorkflow,
  duplicateWorkflow,
  publishWorkflow,
  runWorkflowNow,
  saveDraft,
  setWorkflowPaused,
  simulateDraft,
  updateWorkflowMeta,
  validateDraft,
} from "@/server/services/workflows";
import { cancelWorkflowRun } from "@/server/workflows/engine";

const id = z.string().min(1).max(40);
const payloadSchema = z.record(z.string(), z.unknown()).default({});

export async function createWorkflowAction(input: { name: string; description?: string; departmentId?: string | null }): Promise<ActionResult<{ id: string }>> {
  return runAction(z.object({ name: z.string().trim().min(2, "Name the workflow.").max(80), description: z.string().trim().max(500).optional(), departmentId: id.nullable().optional() }), input, async (d) => {
    const ctx = await requireOrgContext("workflows:write");
    const wf = await createWorkflow(userActor(ctx.org.id, ctx.user.id), d);
    revalidatePath("/workflows");
    return { id: wf.id };
  });
}

export async function saveDraftAction(input: { workflowId: string; graph: unknown; settings: unknown; name?: string; description?: string }): Promise<ActionResult<{ version: number; issues: GraphIssue[] }>> {
  return runAction(z.object({ workflowId: id, graph: z.unknown(), settings: z.unknown(), name: z.string().trim().min(2).max(80).optional(), description: z.string().trim().max(500).optional() }), input, async (d) => {
    const ctx = await requireOrgContext("workflows:write");
    const actor = userActor(ctx.org.id, ctx.user.id);
    if (d.name || d.description !== undefined) await updateWorkflowMeta(actor, d.workflowId, { name: d.name, description: d.description });
    const v = await saveDraft(actor, d.workflowId, d.graph, d.settings);
    const { issues } = await validateDraft(ctx.org.id, d.workflowId, false);
    return { version: v.version, issues };
  });
}

export async function validateWorkflowAction(workflowId: string): Promise<ActionResult<GraphIssue[]>> {
  return runAction(id, workflowId, async (w) => {
    const ctx = await requireOrgContext("workflows:read");
    return (await validateDraft(ctx.org.id, w, true)).issues;
  });
}

export async function simulateWorkflowAction(input: { workflowId: string; payload: Record<string, unknown> }): Promise<ActionResult<{ runId: string }>> {
  return runAction(z.object({ workflowId: id, payload: payloadSchema }), input, async (d) => {
    const ctx = await requireOrgContext("workflows:write");
    await enforceRateLimit("workflowRun", ctx.org.id);
    const run = await simulateDraft(userActor(ctx.org.id, ctx.user.id), d.workflowId, d.payload);
    return { runId: run.id };
  });
}

export async function publishWorkflowAction(workflowId: string): Promise<ActionResult<{ version: number }>> {
  return runAction(id, workflowId, async (w) => {
    const ctx = await requireOrgContext("workflows:publish");
    const res = await publishWorkflow(userActor(ctx.org.id, ctx.user.id), w);
    revalidatePath(`/workflows/${w}`);
    return { version: res.version };
  });
}

export async function runWorkflowAction(input: { workflowId: string; payload: Record<string, unknown> }): Promise<ActionResult<{ runId: string }>> {
  return runAction(z.object({ workflowId: id, payload: payloadSchema }), input, async (d) => {
    const ctx = await requireOrgContext("workflows:run");
    await enforceRateLimit("workflowRun", ctx.org.id);
    const run = await runWorkflowNow(userActor(ctx.org.id, ctx.user.id), d.workflowId, d.payload);
    return { runId: run.id };
  });
}

export async function setWorkflowPausedAction(input: { workflowId: string; paused: boolean }): Promise<ActionResult> {
  return runAction(z.object({ workflowId: id, paused: z.boolean() }), input, async (d) => {
    const ctx = await requireOrgContext("workflows:publish");
    await setWorkflowPaused(userActor(ctx.org.id, ctx.user.id), d.workflowId, d.paused);
    revalidatePath(`/workflows/${d.workflowId}`);
  });
}

export async function deleteWorkflowAction(workflowId: string): Promise<ActionResult> {
  return runAction(id, workflowId, async (w) => {
    const ctx = await requireOrgContext("workflows:write");
    await archiveWorkflow(userActor(ctx.org.id, ctx.user.id), w);
    revalidatePath("/workflows");
  });
}

export async function duplicateWorkflowAction(workflowId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(id, workflowId, async (w) => {
    const ctx = await requireOrgContext("workflows:write");
    const copy = await duplicateWorkflow(userActor(ctx.org.id, ctx.user.id), w);
    return { id: copy.id };
  });
}

export async function cancelWorkflowRunAction(runId: string): Promise<ActionResult> {
  return runAction(id, runId, async (r) => {
    const ctx = await requireOrgContext("workflows:run");
    await cancelWorkflowRun(ctx.org.id, r, ctx.user.id);
    revalidatePath(`/workflows/runs/${r}`);
  });
}

export async function rerunWorkflowAction(runId: string): Promise<ActionResult<{ runId: string }>> {
  return runAction(id, runId, async (r) => {
    const ctx = await requireOrgContext("workflows:run");
    await enforceRateLimit("workflowRun", ctx.org.id);
    const { prisma } = await import("@/lib/db");
    const { notFound } = await import("@/lib/errors");
    const run = await prisma.workflowRun.findFirst({ where: { id: r, orgId: ctx.org.id } });
    if (!run) throw notFound("Workflow run");
    const actor = userActor(ctx.org.id, ctx.user.id);
    const payload = (run.triggerPayload as Record<string, unknown>) ?? {};
    const next = run.mode === "SIMULATION" ? await simulateDraft(actor, run.workflowId, payload) : await runWorkflowNow(actor, run.workflowId, payload);
    return { runId: next.id };
  });
}

export async function revealWebhookSecretAction(workflowId: string): Promise<ActionResult<{ secret: string }>> {
  return runAction(id, workflowId, async (wid) => {
    const ctx = await requireOrgContext("workflows:publish");
    const { revealWebhookSecret } = await import("@/server/services/webhooks");
    return { secret: await revealWebhookSecret({ orgId: ctx.org.id, userId: ctx.user.id, type: "USER" }, wid) };
  });
}

export async function rotateWebhookSecretAction(workflowId: string): Promise<ActionResult<{ secret: string }>> {
  return runAction(id, workflowId, async (wid) => {
    const ctx = await requireOrgContext("workflows:publish");
    const { rotateWebhookSecret } = await import("@/server/services/webhooks");
    return { secret: await rotateWebhookSecret({ orgId: ctx.org.id, userId: ctx.user.id, type: "USER" }, wid) };
  });
}

export async function generateWorkflowAction(input: { description: string }): Promise<ActionResult<import("@/server/services/workflow-generator").GeneratedWorkflow>> {
  return runAction(z.object({ description: z.string().trim().min(10, "Describe the workflow in a sentence or two.").max(4000) }), input, async ({ description }) => {
    const ctx = await requireOrgContext("workflows:write");
    await enforceRateLimit("aiRequest", `${ctx.org.id}:${ctx.user.id}`);
    const { generateWorkflowDraft } = await import("@/server/services/workflow-generator");
    return generateWorkflowDraft(ctx.org.id, description);
  });
}

/** Saves a reviewed, generated graph as a new draft workflow (never published here). */
export async function createGeneratedWorkflowAction(input: { name: string; description?: string; graph: unknown; templateKey?: string }): Promise<ActionResult<{ id: string }>> {
  return runAction(
    z.object({ name: z.string().trim().min(2, "Name the workflow.").max(80), description: z.string().trim().max(500).optional(), graph: z.unknown(), templateKey: z.string().max(60).optional() }),
    input,
    async (d) => {
      const ctx = await requireOrgContext("workflows:write");
      const { graphSchema } = await import("@/lib/workflows/types");
      const graph = graphSchema.parse(d.graph) as import("@/lib/workflows/types").WorkflowGraph;
      const wf = await createWorkflow(userActor(ctx.org.id, ctx.user.id), { name: d.name, description: d.description, graph, templateKey: d.templateKey });
      revalidatePath("/workflows");
      return { id: wf.id };
    },
  );
}
