"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireOrgContext } from "@/lib/auth/context";
import { userActor } from "@/lib/auth/actor";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { addTaskComment, cancelTask, completeTaskManually, createTask, deleteTask, handBackTask, startTask, takeOverTask, updateTask } from "@/server/services/tasks";

const taskSchema = z.object({
  title: z.string().trim().min(3, "Describe the task in a few words.").max(200),
  description: z.string().trim().max(8000).optional(),
  agentId: z.string().max(40).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueAt: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? new Date(v) : null))
    .refine((d) => d === null || !Number.isNaN(d.getTime()), "Invalid date."),
  mode: z.enum(["LIVE", "SIMULATION"]).default("LIVE"),
  runNow: z.boolean().default(true),
});

export async function createTaskAction(input: z.input<typeof taskSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(taskSchema, input, async ({ runNow, ...data }) => {
    const ctx = await requireOrgContext("tasks:write");
    if (runNow && data.agentId) await enforceRateLimit("agentRun", `${ctx.org.id}:${ctx.user.id}`);
    const task = await createTask(userActor(ctx.org.id, ctx.user.id), data, { run: runNow && !!data.agentId });
    revalidatePath("/tasks");
    return { id: task.id };
  });
}

export async function runTaskAction(taskId: string): Promise<ActionResult> {
  return runAction(z.string().min(1), taskId, async (id) => {
    const ctx = await requireOrgContext("tasks:write");
    await enforceRateLimit("agentRun", `${ctx.org.id}:${ctx.user.id}`);
    await startTask(userActor(ctx.org.id, ctx.user.id), id);
    revalidatePath(`/tasks/${id}`);
  });
}

export async function cancelTaskAction(taskId: string): Promise<ActionResult> {
  return runAction(z.string().min(1), taskId, async (id) => {
    const ctx = await requireOrgContext("tasks:write");
    await cancelTask(userActor(ctx.org.id, ctx.user.id), id);
    revalidatePath(`/tasks/${id}`);
  });
}

export async function deleteTaskAction(taskId: string): Promise<ActionResult> {
  return runAction(z.string().min(1), taskId, async (id) => {
    const ctx = await requireOrgContext("tasks:write");
    await deleteTask(userActor(ctx.org.id, ctx.user.id), id);
    revalidatePath("/tasks");
  });
}

const takeoverSchema = z.object({ taskId: z.string().min(1).max(40), note: z.string().trim().max(2000).optional() });

export async function takeOverTaskAction(input: z.input<typeof takeoverSchema>): Promise<ActionResult> {
  return runAction(takeoverSchema, input, async ({ taskId, note }) => {
    const ctx = await requireOrgContext("tasks:write");
    await takeOverTask({ orgId: ctx.org.id, userId: ctx.user.id, type: "USER" }, taskId, note);
    revalidatePath(`/tasks/${taskId}`);
    revalidatePath("/inbox");
    revalidatePath("/approvals");
  });
}

const completeSchema = z.object({ taskId: z.string().min(1).max(40), result: z.string().trim().min(1, "Describe the outcome.").max(20000) });

export async function completeTaskManuallyAction(input: z.input<typeof completeSchema>): Promise<ActionResult> {
  return runAction(completeSchema, input, async ({ taskId, result }) => {
    const ctx = await requireOrgContext("tasks:write");
    await completeTaskManually({ orgId: ctx.org.id, userId: ctx.user.id, type: "USER" }, taskId, result);
    revalidatePath(`/tasks/${taskId}`);
  });
}

const handBackSchema = z.object({ taskId: z.string().min(1).max(40), guidance: z.string().trim().max(4000).optional() });

export async function handBackTaskAction(input: z.input<typeof handBackSchema>): Promise<ActionResult> {
  return runAction(handBackSchema, input, async ({ taskId, guidance }) => {
    const ctx = await requireOrgContext("tasks:write");
    await enforceRateLimit("agentRun", `${ctx.org.id}:${ctx.user.id}`);
    await handBackTask({ orgId: ctx.org.id, userId: ctx.user.id, type: "USER" }, taskId, guidance);
    revalidatePath(`/tasks/${taskId}`);
  });
}

const updateSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(8000).optional(),
  agentId: z.string().max(40).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueAt: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? new Date(v) : null)),
});

export async function updateTaskAction(input: z.input<typeof updateSchema>): Promise<ActionResult> {
  return runAction(updateSchema, input, async ({ taskId, ...data }) => {
    const ctx = await requireOrgContext("tasks:write");
    await updateTask(userActor(ctx.org.id, ctx.user.id), taskId, data);
    revalidatePath(`/tasks/${taskId}`);
  });
}

export async function addCommentAction(input: { taskId: string; body: string }): Promise<ActionResult> {
  return runAction(z.object({ taskId: z.string().min(1), body: z.string().trim().min(1, "Write a comment.").max(5000) }), input, async (data) => {
    const ctx = await requireOrgContext("tasks:write");
    await addTaskComment(userActor(ctx.org.id, ctx.user.id), data.taskId, data.body);
    revalidatePath(`/tasks/${data.taskId}`);
  });
}
