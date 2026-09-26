import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { apiActor, type ApiPrincipal } from "@/server/services/api-keys";
import { createTask } from "@/server/services/tasks";
import { runWorkflowNow } from "@/server/services/workflows";

/** Public API v1 (spec §47): stable, documented JSON shapes — never raw database rows. */

export async function listAgentsForApi(orgId: string) {
  const agents = await prisma.agent.findMany({
    where: { orgId, deletedAt: null },
    orderBy: { name: "asc" },
    take: 200,
    include: { department: { select: { name: true } } },
  });
  return agents.map((a) => ({
    id: a.id,
    name: a.name,
    jobTitle: a.jobTitle,
    department: a.department?.name ?? null,
    status: a.status.toLowerCase(),
    published: a.lifecycle === "PUBLISHED",
    publishedVersion: a.publishedVersion,
  }));
}

export async function listWorkflowsForApi(orgId: string) {
  const workflows = await prisma.workflow.findMany({ where: { orgId, deletedAt: null, status: { not: "ARCHIVED" } }, orderBy: { name: "asc" }, take: 200 });
  return workflows.map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    status: w.status.toLowerCase(),
    trigger: w.triggerType.toLowerCase(),
    publishedVersion: w.publishedVersion,
    runnable: w.status === "ACTIVE" && w.publishedVersion !== null,
  }));
}

export async function getTaskForApi(orgId: string, taskId: string) {
  const t = await prisma.task.findFirst({ where: { id: taskId, orgId, deletedAt: null }, include: { agent: { select: { id: true, name: true } } } });
  if (!t) throw notFound("Task");
  const pendingApprovals = await prisma.approval.count({ where: { taskId: t.id, status: "PENDING" } });
  return {
    id: t.id,
    title: t.title,
    status: t.status.toLowerCase(),
    mode: t.mode.toLowerCase(),
    progress: t.progress,
    currentStep: t.currentStep,
    result: t.result,
    outputs: t.outputs,
    error: t.error,
    agent: t.agent,
    waitingForHuman: pendingApprovals > 0 || t.assigneeUserId !== null,
    pendingApprovals,
    createdAt: t.createdAt.toISOString(),
    startedAt: t.startedAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
  };
}

export async function getWorkflowRunForApi(orgId: string, runId: string) {
  const r = await prisma.workflowRun.findFirst({ where: { id: runId, orgId }, include: { workflow: { select: { id: true, name: true } } } });
  if (!r) throw notFound("Workflow run");
  const pendingApprovals = await prisma.approval.count({ where: { workflowRunId: r.id, status: "PENDING" } });
  return {
    id: r.id,
    workflow: r.workflow,
    version: r.version,
    status: r.status.toLowerCase(),
    mode: r.mode.toLowerCase(),
    trigger: r.trigger.toLowerCase(),
    progress: r.progress,
    output: r.output,
    error: r.error,
    pendingApprovals,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}

export const agentRunBody = z.object({
  input: z.string().trim().min(1, "Describe the work in `input`.").max(20_000),
  title: z.string().trim().min(3).max(200).optional(),
  mode: z.enum(["live", "simulation"]).default("live"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});

/** Gives an employee work: creates a task and starts it in the background. */
export async function runAgentForApi(p: ApiPrincipal, agentId: string, body: z.infer<typeof agentRunBody>) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, orgId: p.orgId, deletedAt: null } });
  if (!agent) throw notFound("AI employee");
  if (agent.status === "PAUSED") throw new AppError("CONFLICT", `${agent.name} is paused.`);
  if (body.mode === "live" && agent.lifecycle !== "PUBLISHED") {
    throw new AppError("CONFLICT", `${agent.name} hasn't been published yet. Publish them, or send "mode": "simulation".`);
  }
  await enforceRateLimit("agentRun", `${p.orgId}:api:${p.apiKeyId}`);
  const firstLine = body.input.split("\n")[0].trim();
  const task = await createTask(
    apiActor(p),
    {
      title: body.title ?? (firstLine.length > 3 ? firstLine.slice(0, 200) : `API request for ${agent.name}`),
      description: body.input,
      agentId: agent.id,
      mode: body.mode === "live" ? "LIVE" : "SIMULATION",
      priority: body.priority.toUpperCase() as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
    },
    { run: true },
  );
  return getTaskForApi(p.orgId, task.id);
}

export const workflowRunBody = z.object({
  input: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export async function runWorkflowForApi(p: ApiPrincipal, workflowId: string, body: z.infer<typeof workflowRunBody>, idempotencyHeader: string | null) {
  const wf = await prisma.workflow.findFirst({ where: { id: workflowId, orgId: p.orgId, deletedAt: null } });
  if (!wf) throw notFound("Workflow");
  await enforceRateLimit("workflowRun", `${p.orgId}:api:${p.apiKeyId}`);
  const key = idempotencyHeader?.trim() || body.idempotencyKey;
  const run = await runWorkflowNow(apiActor(p), wf.id, body.input, "API", key ? `api:${key.slice(0, 200)}` : undefined);
  return getWorkflowRunForApi(p.orgId, run.id);
}
