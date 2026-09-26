import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ExecutionMode, Priority, TaskStatus } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/lib/auth/actor";
import { recordActivity, writeAudit } from "@/server/services/audit";
import { notifyUser } from "@/server/services/notifications";

export interface TaskInput {
  title: string;
  description?: string | null;
  agentId?: string | null;
  departmentId?: string | null;
  priority?: Priority;
  dueAt?: Date | null;
  inputs?: Record<string, unknown> | null;
  mode?: ExecutionMode;
  parentTaskId?: string | null;
  workflowId?: string | null;
  workflowRunId?: string | null;
}

export async function createTask(actor: Actor, input: TaskInput, opts: { run?: boolean } = {}) {
  if (input.agentId) {
    const agent = await prisma.agent.findFirst({ where: { id: input.agentId, orgId: actor.orgId, deletedAt: null } });
    if (!agent) throw notFound("AI employee");
  }
  if (input.departmentId) {
    const dept = await prisma.department.findFirst({ where: { id: input.departmentId, orgId: actor.orgId, deletedAt: null } });
    if (!dept) throw notFound("Department");
  }
  const task = await prisma.task.create({
    data: {
      orgId: actor.orgId,
      title: input.title.trim().slice(0, 200),
      description: input.description?.trim() || null,
      agentId: input.agentId ?? null,
      departmentId: input.departmentId ?? null,
      priority: input.priority ?? "MEDIUM",
      dueAt: input.dueAt ?? null,
      inputs: (input.inputs ?? undefined) as Prisma.InputJsonValue | undefined,
      mode: input.mode ?? "LIVE",
      status: "QUEUED",
      parentTaskId: input.parentTaskId ?? null,
      workflowId: input.workflowId ?? null,
      workflowRunId: input.workflowRunId ?? null,
      createdById: actor.type === "USER" ? (actor.userId ?? null) : null,
      createdByAgentId: actor.type === "AGENT" ? (actor.agentId ?? null) : null,
    },
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, actorAgentId: actor.agentId, actorApiKeyId: actor.apiKeyId, action: "task.create", entityType: "Task", entityId: task.id });
  if (opts.run && task.agentId) await startTask(actor, task.id);
  return task;
}

/** Hands a task to its assigned AI employee (background execution). */
export async function startTask(actor: Actor, taskId: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, orgId: actor.orgId, deletedAt: null }, include: { agent: true } });
  if (!task) throw notFound("Task");
  if (!task.agent) throw new AppError("VALIDATION", "Assign an AI employee before running this task.");
  if (["RUNNING", "AWAITING_APPROVAL", "WAITING"].includes(task.status)) throw new AppError("CONFLICT", "This task is already in progress.");
  const { queueAgentRun } = await import("@/server/runtime/agent-runtime");
  const inputs = task.inputs && typeof task.inputs === "object" && Object.keys(task.inputs).length ? `\n\nInputs:\n${JSON.stringify(task.inputs, null, 2)}` : "";
  const run = await queueAgentRun(actor.orgId, task.agent.id, {
    input: `${task.title}${task.description ? `\n\n${task.description}` : ""}${inputs}`,
    mode: task.mode,
    taskId: task.id,
    taskInstructions: `Complete this task and report the result clearly.${task.dueAt ? ` Due: ${task.dueAt.toISOString()}.` : ""}`,
    useDraft: task.mode === "SIMULATION" || task.agent.lifecycle !== "PUBLISHED",
  });
  await prisma.task.update({
    where: { id: task.id },
    data: { status: "QUEUED", error: null, result: null, progress: 0, currentStep: "Queued", mode: task.agent.lifecycle !== "PUBLISHED" ? "SIMULATION" : task.mode },
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, actorApiKeyId: actor.apiKeyId, action: "task.run", entityType: "Task", entityId: task.id, runId: run.id });
  return run;
}

const PROGRESS_STATES: Record<string, TaskStatus> = {
  RUNNING: "RUNNING",
  AWAITING_APPROVAL: "AWAITING_APPROVAL",
  WAITING: "WAITING",
  CANCELLED: "CANCELLED",
};

export async function onTaskRunStatus(taskId: string, status: "RUNNING" | "AWAITING_APPROVAL" | "WAITING" | "CANCELLED", message?: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  // A person who took the task over owns its status now.
  if (!task || task.assigneeUserId || ["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) return;
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: PROGRESS_STATES[status],
      startedAt: task.startedAt ?? new Date(),
      currentStep: status === "RUNNING" ? "Working" : status === "AWAITING_APPROVAL" ? "Awaiting approval" : status === "WAITING" ? (message?.slice(0, 140) ?? "Waiting for input") : "Cancelled",
      ...(status === "CANCELLED" ? { completedAt: new Date() } : {}),
    },
  });
}

export async function onTaskRunFinished(
  taskId: string,
  runId: string,
  status: "COMPLETED" | "FAILED" | "CANCELLED",
  result: { output?: string; structured?: Record<string, unknown>; error?: string },
) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { agent: { select: { name: true } } } });
  if (!task || task.assigneeUserId) return;
  const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { mode: true } });
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status,
      result: result.output?.slice(0, 20000) ?? null,
      outputs: (result.structured ?? (result.output ? { text: result.output.slice(0, 20000) } : undefined)) as Prisma.InputJsonValue | undefined,
      error: result.error ?? null,
      progress: status === "COMPLETED" ? 100 : task.progress,
      currentStep: status === "COMPLETED" ? "Done" : status === "FAILED" ? "Failed" : "Cancelled",
      completedAt: new Date(),
    },
  });
  const who = task.agent?.name ?? "An employee";
  if (status !== "CANCELLED") {
    await recordActivity({
      orgId: task.orgId,
      category: "TASK",
      actorType: "AGENT",
      actorAgentId: task.agentId,
      summary: status === "COMPLETED" ? `${who} completed ${task.title.charAt(0).toLowerCase()}${task.title.slice(1)}.` : `${who} couldn't complete "${task.title}".`,
      detail: status === "FAILED" ? result.error : undefined,
      entityType: "Task",
      entityId: task.id,
      link: `/tasks/${task.id}`,
      isSimulation: run?.mode === "SIMULATION",
    });
  }
  if (task.createdById) {
    await notifyUser(task.orgId, task.createdById, {
      type: status === "COMPLETED" ? "task_completed" : "task_failed",
      title: status === "COMPLETED" ? `${who} finished "${task.title}"` : `"${task.title}" ${status === "FAILED" ? "failed" : "was cancelled"}`,
      body: status === "FAILED" ? result.error : undefined,
      link: `/tasks/${task.id}`,
    });
  }
}

export async function updateTask(actor: Actor, taskId: string, data: Partial<TaskInput> & { status?: TaskStatus }) {
  const task = await prisma.task.findFirst({ where: { id: taskId, orgId: actor.orgId, deletedAt: null } });
  if (!task) throw notFound("Task");
  if (data.agentId) {
    const agent = await prisma.agent.findFirst({ where: { id: data.agentId, orgId: actor.orgId, deletedAt: null } });
    if (!agent) throw notFound("AI employee");
  }
  await prisma.task.update({
    where: { id: taskId },
    data: {
      title: data.title?.trim().slice(0, 200),
      description: data.description === undefined ? undefined : data.description?.trim() || null,
      agentId: data.agentId === undefined ? undefined : data.agentId,
      priority: data.priority,
      dueAt: data.dueAt === undefined ? undefined : data.dueAt,
      inputs: data.inputs === undefined ? undefined : ((data.inputs ?? undefined) as Prisma.InputJsonValue | undefined),
    },
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "task.update", entityType: "Task", entityId: taskId });
}

export async function cancelTask(actor: Actor, taskId: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, orgId: actor.orgId, deletedAt: null } });
  if (!task) throw notFound("Task");
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) return;
  const runs = await prisma.agentRun.findMany({ where: { taskId, status: { in: ["QUEUED", "RUNNING", "AWAITING_APPROVAL", "WAITING"] } } });
  const { cancelAgentRun } = await import("@/server/runtime/agent-runtime");
  for (const r of runs) await cancelAgentRun(actor.orgId, r.id);
  await prisma.task.update({ where: { id: taskId }, data: { status: "CANCELLED", completedAt: new Date(), currentStep: "Cancelled" } });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "task.cancel", entityType: "Task", entityId: taskId });
}

/**
 * Human takeover: stops the AI employee's work on a task (cancelling its runs
 * and pending approvals) and makes the person responsible for finishing it.
 */
export async function takeOverTask(actor: Actor & { userId: string }, taskId: string, note?: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, orgId: actor.orgId, deletedAt: null }, include: { agent: { select: { name: true } } } });
  if (!task) throw notFound("Task");
  if (["COMPLETED", "CANCELLED"].includes(task.status)) throw new AppError("CONFLICT", `This task is already ${task.status.toLowerCase()}.`);
  if (task.assigneeUserId) throw new AppError("CONFLICT", task.assigneeUserId === actor.userId ? "You already took over this task." : "Someone else already took over this task.");

  // Claim first so a finishing run can't overwrite the takeover.
  const claimed = await prisma.task.updateMany({
    where: { id: taskId, assigneeUserId: null },
    data: { assigneeUserId: actor.userId, takenOverAt: new Date(), status: "WAITING", currentStep: "Taken over by a person", completedAt: null, error: null },
  });
  if (claimed.count === 0) throw new AppError("CONFLICT", "Someone else just took over this task.");

  const runs = await prisma.agentRun.findMany({ where: { taskId, status: { in: ["QUEUED", "RUNNING", "AWAITING_APPROVAL", "WAITING"] } } });
  const { cancelAgentRun } = await import("@/server/runtime/agent-runtime");
  for (const r of runs) await cancelAgentRun(actor.orgId, r.id);
  await prisma.approval.updateMany({ where: { orgId: actor.orgId, taskId, status: "PENDING" }, data: { status: "CANCELLED", decidedById: actor.userId, decidedAt: new Date(), decisionNote: "Task taken over by a person." } });

  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
  const text = `${user?.name ?? "A teammate"} took over this task${task.agent ? ` from ${task.agent.name}` : ""}.${note?.trim() ? ` Note: ${note.trim()}` : ""}`;
  await prisma.taskComment.create({ data: { orgId: actor.orgId, taskId, authorUserId: actor.userId, body: text.slice(0, 5000) } });
  await writeAudit({ orgId: actor.orgId, actorType: "USER", actorUserId: actor.userId, action: "task.takeover", entityType: "Task", entityId: taskId, metadata: { cancelledRuns: runs.map((r) => r.id) } });
  await recordActivity({
    orgId: actor.orgId,
    category: "TASK",
    actorType: "USER",
    actorUserId: actor.userId,
    actorAgentId: task.agentId,
    summary: `${user?.name ?? "A teammate"} took over “${task.title}”${task.agent ? ` from ${task.agent.name}` : ""}.`,
    entityType: "Task",
    entityId: taskId,
    link: `/tasks/${taskId}`,
    isSimulation: task.mode === "SIMULATION",
  });
}

/** The person who took a task over records the outcome and closes it. */
export async function completeTaskManually(actor: Actor & { userId: string }, taskId: string, result: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, orgId: actor.orgId, deletedAt: null } });
  if (!task) throw notFound("Task");
  if (task.assigneeUserId !== actor.userId) throw new AppError("FORBIDDEN", "Only the person who took over this task can complete it.");
  if (["COMPLETED", "CANCELLED"].includes(task.status)) throw new AppError("CONFLICT", `This task is already ${task.status.toLowerCase()}.`);
  const text = result.trim();
  if (!text) throw new AppError("VALIDATION", "Describe the outcome.", { fieldErrors: { result: "Describe the outcome." } });
  await prisma.task.update({
    where: { id: taskId },
    data: { status: "COMPLETED", result: text.slice(0, 20000), outputs: { text: text.slice(0, 20000), completedBy: "human" }, progress: 100, currentStep: "Done (by a person)", completedAt: new Date(), error: null },
  });
  await writeAudit({ orgId: actor.orgId, actorType: "USER", actorUserId: actor.userId, action: "task.complete_manual", entityType: "Task", entityId: taskId });
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
  await recordActivity({
    orgId: actor.orgId,
    category: "TASK",
    actorType: "USER",
    actorUserId: actor.userId,
    summary: `${user?.name ?? "A teammate"} completed “${task.title}” manually.`,
    entityType: "Task",
    entityId: taskId,
    link: `/tasks/${taskId}`,
  });
}

/** Gives a taken-over task back to its AI employee and restarts it with the person's guidance. */
export async function handBackTask(actor: Actor & { userId: string }, taskId: string, guidance?: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, orgId: actor.orgId, deletedAt: null } });
  if (!task) throw notFound("Task");
  if (!task.assigneeUserId) throw new AppError("CONFLICT", "Nobody has taken over this task.");
  if (task.assigneeUserId !== actor.userId) throw new AppError("FORBIDDEN", "Only the person who took over this task can hand it back.");
  if (!task.agentId) throw new AppError("VALIDATION", "Assign an AI employee first.");
  if (["COMPLETED", "CANCELLED"].includes(task.status)) throw new AppError("CONFLICT", `This task is already ${task.status.toLowerCase()}.`);
  const extra = guidance?.trim();
  await prisma.task.update({
    where: { id: taskId },
    data: {
      assigneeUserId: null,
      takenOverAt: null,
      status: "QUEUED",
      description: extra ? `${task.description ? `${task.description}\n\n` : ""}Guidance from your manager: ${extra}`.slice(0, 8000) : undefined,
    },
  });
  if (extra) await prisma.taskComment.create({ data: { orgId: actor.orgId, taskId, authorUserId: actor.userId, body: `Handed back with guidance: ${extra}`.slice(0, 5000) } });
  await writeAudit({ orgId: actor.orgId, actorType: "USER", actorUserId: actor.userId, action: "task.handback", entityType: "Task", entityId: taskId });
  return startTask(actor, taskId);
}

export async function deleteTask(actor: Actor, taskId: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, orgId: actor.orgId, deletedAt: null } });
  if (!task) throw notFound("Task");
  if (["RUNNING", "AWAITING_APPROVAL", "WAITING"].includes(task.status)) await cancelTask(actor, taskId);
  await prisma.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "task.delete", entityType: "Task", entityId: taskId });
}

export async function addTaskComment(actor: Actor, taskId: string, body: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, orgId: actor.orgId, deletedAt: null } });
  if (!task) throw notFound("Task");
  return prisma.taskComment.create({ data: { orgId: actor.orgId, taskId, authorUserId: actor.userId ?? null, authorAgentId: actor.agentId ?? null, body: body.trim().slice(0, 5000) } });
}
