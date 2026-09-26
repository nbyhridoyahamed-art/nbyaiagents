import os from "node:os";
import { prisma } from "@/lib/db";
import type { Prisma, WorkflowRun } from "@/lib/generated/prisma/client";
import type { ExecutionMode, StepStatus, TriggerType } from "@/lib/generated/prisma/enums";
import { AppError, isAppError } from "@/lib/errors";
import { callModel } from "@/lib/ai/router";
import { estimateCostUsd } from "@/lib/ai/models";
import { textOf } from "@/lib/ai/types";
import { outputJsonSchema, validateOutput, type OutputSpec } from "@/lib/ai/output-spec";
import { redact, summarizeForLog } from "@/lib/security/redact";
import { NODE_CONFIG_SCHEMAS, isTrigger, workflowSettingsSchema, type GraphNode, type WorkflowGraph, type WorkflowSettings } from "@/lib/workflows/types";
import { evaluateGroup, resolveDeep, resolveTemplate, resolveText, type ExpressionContext } from "@/lib/workflows/expressions";
import { graphFromRows, incoming, loopBody, outgoing } from "@/lib/workflows/validate-graph";
import { defaultModelFor } from "@/server/services/ai-providers";
import { executeTool } from "@/server/tools/executor";
import { createApproval } from "@/server/services/approvals";
import { recordActivity, writeAudit } from "@/server/services/audit";
import { notifyUser } from "@/server/services/notifications";
import { enqueue } from "@/server/jobs/queue";
import { SYSTEM_SAFETY, wrapUntrusted } from "@/server/runtime/context-builder";

/**
 * Workflow engine (spec §41):
 *   Graph → Validate → Execution plan → Queue → Node runner → Persist → Next node
 *
 * Runs are durable state machines advanced by background jobs. State is
 * persisted after every node, so a crash or restart resumes where it left off.
 * Branches use dead-path elimination: an untaken branch marks its edges
 * "skipped", which lets Merge/join nodes resolve.
 */

type NodeStatus = "PENDING" | "RUNNING" | "WAITING" | "COMPLETED" | "FAILED" | "SKIPPED";

interface NodeState {
  status: NodeStatus;
  output?: unknown;
  error?: string;
  attempts: number;
  rejected?: boolean;
  handled?: boolean;
  waitingOn?: { kind: "approval" | "agent_run" | "delay" | "retry"; id?: string; resumeAt?: string };
  stepId?: string;
}

export interface EngineState {
  v: 1;
  vars: Record<string, unknown>;
  trigger: Record<string, unknown>;
  nodes: Record<string, NodeState>;
  edges: Record<string, "taken" | "skipped">;
  results: Record<string, unknown>;
  seq: number;
  loopBodies: string[];
  counters: { steps: number; toolCalls: number; tokens: number; costUsd: number };
  stoppedReason?: string;
}

type NodeOutcome =
  | { kind: "completed"; output?: unknown; handles?: string[] }
  | { kind: "waiting"; waitingOn: NodeState["waitingOn"] }
  | { kind: "failed"; error: string; retryable: boolean; rejected?: boolean };

const WORKER = `${os.hostname()}:${process.pid}`;
const LEASE_MS = 5 * 60 * 1000;

// ── Starting runs ───────────────────────────────────────────────────────────

export interface StartWorkflowRunInput {
  orgId: string;
  workflowId: string;
  trigger: TriggerType;
  payload: Record<string, unknown>;
  mode: ExecutionMode;
  idempotencyKey?: string;
  createdById?: string | null;
  /** Set when the run was started through the public API or an authenticated webhook. */
  apiKeyId?: string | null;
  /** Simulations run the current draft; live runs always use the published version. */
  versionId?: string;
  parentRunId?: string | null;
}

export async function startWorkflowRun(input: StartWorkflowRunInput): Promise<WorkflowRun> {
  const workflow = await prisma.workflow.findFirst({ where: { id: input.workflowId, orgId: input.orgId, deletedAt: null }, include: { organization: { select: { suspendedAt: true } } } });
  if (!workflow) throw new AppError("NOT_FOUND", "Workflow not found.");
  if (workflow.organization.suspendedAt) throw new AppError("FORBIDDEN", "This company workspace is suspended, so nothing new can run.");

  if (input.idempotencyKey) {
    const existing = await prisma.workflowRun.findUnique({ where: { orgId_idempotencyKey: { orgId: input.orgId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return existing;
  }

  let version;
  if (input.mode === "LIVE") {
    if (workflow.status !== "ACTIVE" || workflow.publishedVersion === null) {
      throw new AppError("VALIDATION", workflow.status === "PAUSED" ? "This workflow is paused." : "Publish this workflow before running it live. You can run a simulation any time.");
    }
    version = await prisma.workflowVersion.findUniqueOrThrow({ where: { workflowId_version: { workflowId: workflow.id, version: workflow.publishedVersion } } });
  } else {
    version = input.versionId
      ? await prisma.workflowVersion.findFirstOrThrow({ where: { id: input.versionId, workflowId: workflow.id } })
      : await prisma.workflowVersion.findFirstOrThrow({ where: { workflowId: workflow.id }, orderBy: { version: "desc" } });
  }
  const nodes = await prisma.workflowNode.findMany({ where: { versionId: version.id } });
  const graph = graphFromRows(nodes, await prisma.workflowEdge.findMany({ where: { versionId: version.id } }));
  const loopBodies = graph.nodes.filter((n) => n.type === "logic.loop").flatMap((n) => loopBody(graph, n.key));

  const state: EngineState = {
    v: 1,
    vars: {},
    trigger: input.payload ?? {},
    nodes: Object.fromEntries(graph.nodes.map((n) => [n.key, { status: "PENDING" as NodeStatus, attempts: 0 }])),
    edges: {},
    results: {},
    seq: 0,
    loopBodies,
    counters: { steps: 0, toolCalls: 0, tokens: 0, costUsd: 0 },
  };

  let run: WorkflowRun;
  try {
    run = await prisma.workflowRun.create({
      data: {
        orgId: input.orgId,
        workflowId: workflow.id,
        versionId: version.id,
        version: version.version,
        mode: input.mode,
        trigger: input.trigger,
        triggerPayload: (redact(input.payload) ?? {}) as Prisma.InputJsonValue,
        state: state as unknown as Prisma.InputJsonValue,
        idempotencyKey: input.idempotencyKey ?? null,
        createdById: input.createdById ?? null,
        parentRunId: input.parentRunId ?? null,
      },
    });
  } catch (err) {
    // Two identical triggers raced: return the one that won.
    if (input.idempotencyKey && String(err).includes("Unique constraint")) {
      return prisma.workflowRun.findUniqueOrThrow({ where: { orgId_idempotencyKey: { orgId: input.orgId, idempotencyKey: input.idempotencyKey } } });
    }
    throw err;
  }
  await prisma.usageRecord.create({ data: { orgId: input.orgId, kind: "WORKFLOW_RUN", workflowRunId: run.id, isSimulation: input.mode === "SIMULATION" } });
  await writeAudit({
    orgId: input.orgId,
    actorType: input.createdById ? "USER" : input.apiKeyId ? "API_KEY" : "SYSTEM",
    actorUserId: input.createdById ?? null,
    actorApiKeyId: input.apiKeyId ?? null,
    action: input.mode === "SIMULATION" ? "workflow.simulate" : "workflow.run",
    entityType: "WorkflowRun",
    entityId: run.id,
    workflowRunId: run.id,
    metadata: { workflowId: workflow.id, version: version.version, trigger: input.trigger },
  });
  await enqueue("workflow.advance", { workflowRunId: run.id }, { orgId: input.orgId });
  return run;
}

export async function cancelWorkflowRun(orgId: string, runId: string, userId?: string | null) {
  const run = await prisma.workflowRun.findFirst({ where: { id: runId, orgId } });
  if (!run) throw new AppError("NOT_FOUND", "Run not found.");
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) return;
  await prisma.workflowRun.update({ where: { id: runId }, data: { cancelRequested: true } });
  const { cancelAgentRun } = await import("@/server/runtime/agent-runtime");
  const agentRuns = await prisma.agentRun.findMany({ where: { workflowRunId: runId, status: { in: ["QUEUED", "RUNNING", "AWAITING_APPROVAL", "WAITING"] } } });
  for (const r of agentRuns) await cancelAgentRun(orgId, r.id);
  await prisma.approval.updateMany({ where: { workflowRunId: runId, status: "PENDING" }, data: { status: "CANCELLED" } });
  await writeAudit({ orgId, actorType: userId ? "USER" : "SYSTEM", actorUserId: userId, action: "workflow.run.cancel", entityType: "WorkflowRun", entityId: runId, workflowRunId: runId });
  await enqueue("workflow.advance", { workflowRunId: runId }, { orgId });
}

// ── Advancing ───────────────────────────────────────────────────────────────

async function acquireLease(runId: string) {
  const now = new Date();
  const res = await prisma.workflowRun.updateMany({
    where: { id: runId, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }, { leaseOwner: WORKER }] },
    data: { leaseOwner: WORKER, leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  return res.count === 1;
}

async function releaseLease(runId: string) {
  await prisma.workflowRun.updateMany({ where: { id: runId, leaseOwner: WORKER }, data: { leaseOwner: null, leaseUntil: null } });
}

export async function advanceWorkflowRun(runId: string, _signal: { approvalId?: string; agentRunId?: string } = {}) {
  void _signal;
  if (!(await acquireLease(runId))) {
    // Another worker is advancing this run; retry shortly so no wake-up signal is lost.
    await enqueue("workflow.advance", { workflowRunId: runId }, { delayMs: 3000 });
    return;
  }
  try {
    await advanceLocked(runId);
  } finally {
    await releaseLease(runId);
  }
}

interface Loaded {
  run: WorkflowRun & { workflow: { id: string; name: string; orgId: string } };
  graph: WorkflowGraph;
  settings: WorkflowSettings;
  state: EngineState;
  ctxBase: Omit<ExpressionContext, "vars" | "trigger" | "nodes">;
}

async function load(runId: string): Promise<Loaded | null> {
  const run = await prisma.workflowRun.findUnique({ where: { id: runId }, include: { workflow: { select: { id: true, name: true, orgId: true } }, workflowVersion: true } });
  if (!run) return null;
  const [nodes, edges, org] = await Promise.all([
    prisma.workflowNode.findMany({ where: { versionId: run.versionId } }),
    prisma.workflowEdge.findMany({ where: { versionId: run.versionId } }),
    prisma.organization.findUniqueOrThrow({ where: { id: run.orgId }, select: { name: true, timezone: true } }),
  ]);
  const settings = workflowSettingsSchema.parse(run.workflowVersion.settings ?? {});
  return {
    run,
    graph: graphFromRows(nodes, edges),
    settings,
    state: run.state as unknown as EngineState,
    ctxBase: { workflow: { id: run.workflowId, name: run.workflow.name, runId: run.id }, company: { name: org.name, timezone: org.timezone } },
  };
}

function exprCtx(l: Loaded, extra: Partial<ExpressionContext> = {}): ExpressionContext {
  const nodes = Object.fromEntries(Object.entries(l.state.nodes).map(([k, v]) => [k, v.output]));
  return { ...l.ctxBase, vars: l.state.vars, trigger: l.state.trigger, nodes, ...extra };
}

async function persist(l: Loaded, extra: Prisma.WorkflowRunUpdateInput = {}) {
  const countable = l.graph.nodes.filter((n) => !l.state.loopBodies.includes(n.key));
  const done = countable.filter((n) => ["COMPLETED", "SKIPPED", "FAILED"].includes(l.state.nodes[n.key]?.status)).length;
  await prisma.workflowRun.update({
    where: { id: l.run.id },
    data: {
      state: l.state as unknown as Prisma.InputJsonValue,
      stepCount: l.state.counters.steps,
      toolCallCount: l.state.counters.toolCalls,
      tokenCount: l.state.counters.tokens,
      costUsd: l.state.counters.costUsd,
      progress: countable.length ? Math.round((done / countable.length) * 100) : 0,
      leaseUntil: new Date(Date.now() + LEASE_MS),
      ...extra,
    },
  });
}

async function advanceLocked(runId: string) {
  const l = await load(runId);
  if (!l || ["COMPLETED", "FAILED", "CANCELLED"].includes(l.run.status)) return;
  const { run, graph, settings, state } = l;

  if (run.status === "QUEUED") {
    await prisma.workflowRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt: new Date() } });
    l.run.startedAt = new Date();
  }
  if (run.cancelRequested) return finishRun(l, "CANCELLED", "Cancelled by a human.");

  // 1. Resolve nodes that were waiting on something external.
  for (const node of graph.nodes) {
    const ns = state.nodes[node.key];
    if (ns?.status !== "WAITING" || !ns.waitingOn) continue;
    const outcome = await resolveWaiting(l, node, ns);
    if (outcome) await applyOutcome(l, node, outcome);
  }
  await persist(l);

  // 2. Execute every ready node until nothing more can run now.
  while (true) {
    const fresh = await prisma.workflowRun.findUnique({ where: { id: runId }, select: { cancelRequested: true } });
    if (fresh?.cancelRequested) return finishRun(l, "CANCELLED", "Cancelled by a human.");
    const limit = limitProblem(l, settings);
    if (limit) return failRun(l, limit);

    const ready = readyNodes(l);
    if (ready.length === 0) break;
    for (const node of ready) {
      const outcome = await runNode(l, node);
      await applyOutcome(l, node, outcome);
      await persist(l);
      if (state.stoppedReason) break;
    }
    if (state.stoppedReason) break;
  }

  // 3. Decide the run status.
  const statuses = Object.entries(state.nodes).filter(([k]) => !state.loopBodies.includes(k));
  const waiting = statuses.filter(([, s]) => s.status === "WAITING");
  const unhandledFailure = statuses.find(([, s]) => s.status === "FAILED" && !s.handled && !s.rejected);

  if (unhandledFailure) {
    const node = graph.nodes.find((n) => n.key === unhandledFailure[0]);
    return failRun(l, `Step “${node?.label ?? unhandledFailure[0]}” failed: ${unhandledFailure[1].error ?? "unknown error"}`);
  }
  if (waiting.length) {
    let awaitingHuman = false;
    for (const [, s] of waiting) {
      if (s.waitingOn?.kind === "approval") awaitingHuman = true;
      if (s.waitingOn?.kind === "agent_run" && s.waitingOn.id) {
        const ar = await prisma.agentRun.findUnique({ where: { id: s.waitingOn.id }, select: { status: true } });
        if (ar?.status === "AWAITING_APPROVAL" || ar?.status === "WAITING") awaitingHuman = true;
      }
      if ((s.waitingOn?.kind === "delay" || s.waitingOn?.kind === "retry") && s.waitingOn.resumeAt) {
        await enqueue("workflow.advance", { workflowRunId: runId }, { runAt: new Date(s.waitingOn.resumeAt), dedupeKey: `wf-wake:${runId}:${s.waitingOn.resumeAt}` });
      }
    }
    await persist(l, { status: awaitingHuman ? "AWAITING_APPROVAL" : "WAITING" });
    await syncTask(l, awaitingHuman ? "AWAITING_APPROVAL" : "WAITING");
    return;
  }
  return finishRun(l, "COMPLETED", state.stoppedReason);
}

function limitProblem(l: Loaded, s: WorkflowSettings): string | null {
  const c = l.state.counters;
  if (c.steps >= s.maxSteps) return `Reached the step limit (${s.maxSteps}).`;
  if (c.toolCalls > s.maxToolCalls) return `Reached the tool-call limit (${s.maxToolCalls}).`;
  if (c.tokens >= s.maxTokens) return `Reached the token limit (${s.maxTokens.toLocaleString()}).`;
  if (s.maxCostUsd > 0 && c.costUsd >= s.maxCostUsd) return `Reached the cost limit ($${s.maxCostUsd}).`;
  const started = l.run.startedAt?.getTime() ?? l.run.createdAt.getTime();
  if (Date.now() - started > s.timeoutMinutes * 60 * 1000) return `Timed out after ${s.timeoutMinutes} minutes.`;
  return null;
}

/** Nodes whose inputs are all resolved. Nodes whose inputs were all skipped are skipped too. */
function readyNodes(l: Loaded): GraphNode[] {
  const { graph, state } = l;
  const ready: GraphNode[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes) {
      const ns = state.nodes[node.key];
      if (!ns || ns.status !== "PENDING" || state.loopBodies.includes(node.key)) continue;
      if (isTrigger(node.type)) {
        if (!ready.includes(node)) ready.push(node);
        continue;
      }
      const inc = incoming(graph, node.key).filter((e) => !state.loopBodies.includes(e.source));
      if (inc.length === 0) continue;
      const resolved = inc.every((e) => state.edges[e.key]);
      if (!resolved) continue;
      if (inc.some((e) => state.edges[e.key] === "taken")) {
        if (!ready.includes(node)) ready.push(node);
      } else {
        ns.status = "SKIPPED";
        for (const e of outgoing(graph, node.key)) state.edges[e.key] = "skipped";
        changed = true;
      }
    }
  }
  return ready;
}

async function applyOutcome(l: Loaded, node: GraphNode, outcome: NodeOutcome) {
  const { graph, state } = l;
  const ns = state.nodes[node.key];
  const config = node.config as { outputVar?: string; retry?: { maxAttempts: number; backoffSeconds: number }; continueOnError?: boolean };

  if (outcome.kind === "waiting") {
    ns.status = "WAITING";
    ns.waitingOn = outcome.waitingOn;
    if (ns.stepId) await updateStep(ns.stepId, outcome.waitingOn?.kind === "approval" ? "AWAITING_APPROVAL" : "WAITING");
    return;
  }

  if (outcome.kind === "completed") {
    ns.status = "COMPLETED";
    ns.output = outcome.output;
    ns.waitingOn = undefined;
    ns.error = undefined;
    if (config.outputVar) state.vars[config.outputVar] = outcome.output;
    const handles = outcome.handles ?? ["out"];
    for (const e of outgoing(graph, node.key)) {
      if (state.loopBodies.includes(e.target) && node.type === "logic.loop") continue;
      state.edges[e.key] = handles.includes(e.sourceHandle ?? "out") ? "taken" : "skipped";
    }
    if (ns.stepId) await updateStep(ns.stepId, "SUCCEEDED", { output: summarizeForLog(outcome.output, 4000) });
    return;
  }

  // Failed
  const retry = config.retry ?? { maxAttempts: 1, backoffSeconds: 30 };
  if (outcome.retryable && ns.attempts < retry.maxAttempts) {
    const resumeAt = new Date(Date.now() + retry.backoffSeconds * 1000 * 2 ** (ns.attempts - 1)).toISOString();
    ns.status = "WAITING";
    ns.waitingOn = { kind: "retry", resumeAt };
    ns.error = outcome.error;
    if (ns.stepId) await updateStep(ns.stepId, "FAILED", { error: outcome.error, retryAt: resumeAt });
    return;
  }
  ns.status = "FAILED";
  ns.error = outcome.error;
  ns.waitingOn = undefined;
  ns.rejected = outcome.rejected;
  if (ns.stepId) await updateStep(ns.stepId, outcome.rejected ? "DENIED" : "FAILED", undefined, outcome.error);

  const errorEdges = outgoing(graph, node.key, "error");
  if (errorEdges.length || config.continueOnError) {
    ns.handled = true;
    ns.output = { error: outcome.error };
    for (const e of outgoing(graph, node.key)) {
      const h = e.sourceHandle ?? "out";
      state.edges[e.key] = errorEdges.length ? (h === "error" ? "taken" : "skipped") : h === "error" ? "skipped" : "taken";
    }
    return;
  }
  // A human rejection ends this path gracefully; everything downstream is skipped.
  for (const e of outgoing(graph, node.key)) state.edges[e.key] = "skipped";
  if (outcome.rejected) state.stoppedReason = `Stopped: ${outcome.error}`;
}

// ── Node execution ──────────────────────────────────────────────────────────

async function runNode(l: Loaded, node: GraphNode, loop?: { index: number; item: unknown }): Promise<NodeOutcome> {
  const { run, state } = l;
  const ns = state.nodes[node.key];
  ns.attempts++;
  ns.status = "RUNNING";
  state.counters.steps++;
  state.seq++;
  const ctx = exprCtx(l, loop ? { loop, vars: { ...state.vars } } : {});
  if (!loop) {
    const step = await prisma.workflowRunStep.create({
      data: { orgId: run.orgId, runId: run.id, nodeKey: node.key, nodeType: node.type, label: node.label, sequence: state.seq, status: "RUNNING", attempt: ns.attempts, startedAt: new Date() },
    });
    ns.stepId = step.id;
  }
  const parsed = NODE_CONFIG_SCHEMAS[node.type].safeParse(node.config);
  if (!parsed.success) return { kind: "failed", error: `Invalid configuration: ${parsed.error.issues[0]?.message}`, retryable: false };
  const cfg = parsed.data as Record<string, unknown>;
  const simulation = run.mode === "SIMULATION";

  try {
    switch (node.type) {
      case "trigger.manual":
      case "trigger.schedule":
      case "trigger.webhook":
      case "trigger.api":
      case "trigger.event":
        return { kind: "completed", output: state.trigger };

      case "ai.prompt":
      case "ai.analyze":
      case "ai.generate":
      case "ai.summarize": {
        const c = cfg as { prompt: string; input?: string; outputSpec?: OutputSpec; provider?: string; model?: string };
        const prompt = `${resolvePrompt(c.prompt, ctx)}${c.input ? `\n\n${resolvePrompt(c.input, ctx)}` : ""}`;
        return aiStep(l, node, prompt, c.outputSpec, c);
      }
      case "ai.classify": {
        const c = cfg as { input: string; categories: string[]; instructions: string; provider?: string; model?: string };
        const spec: OutputSpec = {
          name: "classification",
          fields: [
            { name: "category", type: "string", enum: c.categories, description: "The best matching category", required: true },
            { name: "confidence", type: "number", min: 0, max: 1, description: "0 to 1", required: true },
            { name: "reason", type: "string", description: "Short justification", required: true },
          ],
        };
        return aiStep(l, node, `Classify the input into exactly one category: ${c.categories.join(", ")}.${c.instructions ? `\n${c.instructions}` : ""}\n\nInput:\n${resolvePrompt(c.input, ctx)}`, spec, c);
      }
      case "ai.extract": {
        const c = cfg as { input: string; outputSpec: OutputSpec; instructions: string; provider?: string; model?: string };
        return aiStep(l, node, `Extract the requested fields from the input. Use null-safe defaults only if the input truly lacks a value.${c.instructions ? `\n${c.instructions}` : ""}\n\nInput:\n${resolvePrompt(c.input, ctx)}`, c.outputSpec, c);
      }
      case "ai.decision": {
        const c = cfg as { question: string; options: string[]; provider?: string; model?: string };
        const spec: OutputSpec = {
          name: "decision",
          fields: [
            { name: "decision", type: "string", enum: c.options, description: "The chosen option", required: true },
            { name: "reason", type: "string", description: "Why", required: true },
          ],
        };
        return aiStep(l, node, `${resolvePrompt(c.question, ctx)}\n\nChoose exactly one of: ${c.options.join(", ")}.`, spec, c);
      }
      case "ai.research":
      case "agent.run": {
        const c = cfg as { agentId: string; instructions?: string; topic?: string; outputSpec?: OutputSpec };
        // Values substituted from triggers or earlier steps may come from outside (webhooks, emails, web pages):
        // they're marked untrusted so they can never read as instructions to the employee.
        const instructions = node.type === "ai.research" ? `Research the following and report sourced findings. Say clearly what you could not verify.\n\n${resolvePrompt(c.topic ?? "", ctx)}` : resolvePrompt(c.instructions ?? "", ctx);
        return startAgentStep(l, node, c.agentId, instructions, c.outputSpec ?? null, loop);
      }
      case "tool.call": {
        const c = cfg as { toolKey: string; input: Record<string, unknown>; agentId?: string };
        return toolStep(l, node, c.toolKey, resolveDeep(c.input, ctx) as Record<string, unknown>, c.agentId ?? l.settings.defaultAgentId ?? null, loop, undefined);
      }
      case "logic.if": {
        const ok = evaluateGroup((cfg as { condition: never }).condition, ctx);
        return { kind: "completed", output: { result: ok }, handles: [ok ? "true" : "false"] };
      }
      case "logic.switch": {
        const cases = (cfg as { cases: { handle: string; condition: never }[] }).cases;
        const hit = cases.find((c) => evaluateGroup(c.condition, ctx));
        return { kind: "completed", output: { case: hit?.handle ?? "default" }, handles: [hit?.handle ?? "default"] };
      }
      case "logic.filter": {
        const ok = evaluateGroup((cfg as { condition: never }).condition, ctx);
        return { kind: "completed", output: { passed: ok }, handles: ok ? ["out"] : [] };
      }
      case "logic.merge": {
        const merged = Object.fromEntries(incoming(l.graph, node.key).filter((e) => state.edges[e.key] === "taken").map((e) => [e.source, state.nodes[e.source]?.output]));
        return { kind: "completed", output: merged };
      }
      case "logic.parallel":
        return { kind: "completed", output: {} };
      case "logic.delay": {
        if (simulation) return { kind: "completed", output: { simulated: true, note: `Would wait ${(cfg as { seconds: number }).seconds}s` } };
        const resumeAt = new Date(Date.now() + (cfg as { seconds: number }).seconds * 1000).toISOString();
        return { kind: "waiting", waitingOn: { kind: "delay", resumeAt } };
      }
      case "logic.loop":
        return loopStep(l, node, cfg as { items: string; maxItems: number; itemVar: string });

      case "human.approval":
      case "human.review":
      case "human.input": {
        if (simulation) {
          const note = node.type === "human.input" ? { answer: "(simulation — no human input)", simulated: true } : { approved: true, simulated: true, note: "Would request human approval — assumed approved in simulation." };
          return { kind: "completed", output: note, handles: node.type === "human.input" ? ["out"] : ["approved"] };
        }
        const c = cfg as { title?: string; details?: string; content?: string; question?: string };
        const approval = await createApproval({
          orgId: run.orgId,
          kind: node.type === "human.input" ? "INPUT_REQUEST" : "REVIEW",
          title: resolveText(c.title ?? c.question ?? node.label, ctx).slice(0, 200),
          summary: `Workflow “${l.run.workflow.name}”`,
          question: node.type === "human.input" ? resolveText(c.question ?? "", ctx) : null,
          proposedInput:
            node.type === "human.review" ? { content: resolveText(c.content ?? "", ctx) } : node.type === "human.approval" ? { details: resolveText(c.details ?? "", ctx) } : null,
          workflowRunId: run.id,
          workflowStepId: state.nodes[node.key].stepId ?? null,
          agentId: l.settings.defaultAgentId ?? null,
        });
        await prisma.workflowRunStep.update({ where: { id: state.nodes[node.key].stepId! }, data: { approvalId: approval.id } });
        return { kind: "waiting", waitingOn: { kind: "approval", id: approval.id } };
      }

      case "data.set": {
        for (const a of (cfg as { assignments: { name: string; value: string }[] }).assignments) {
          setPath(state.vars, a.name, resolveTemplate(a.value, ctx));
        }
        return { kind: "completed", output: { ...state.vars } };
      }
      case "data.transform":
        return { kind: "completed", output: resolveDeep((cfg as { template: unknown }).template, ctx) };
      case "data.parse_json": {
        const raw = resolveTemplate((cfg as { source: string }).source, ctx);
        if (typeof raw === "object" && raw !== null) return { kind: "completed", output: raw };
        try {
          return { kind: "completed", output: JSON.parse(String(raw ?? "")) };
        } catch {
          return { kind: "failed", error: "The value isn't valid JSON.", retryable: false };
        }
      }
      case "data.store": {
        const c = cfg as { key: string; value: string };
        state.results[c.key] = resolveTemplate(c.value, ctx);
        return { kind: "completed", output: { [c.key]: state.results[c.key] } };
      }
      case "flow.end": {
        const out = (cfg as { output: string }).output;
        const value = out ? resolveTemplate(out, ctx) : state.results;
        state.results.__end = value;
        return { kind: "completed", output: value, handles: [] };
      }
    }
  } catch (err) {
    return { kind: "failed", error: isAppError(err) ? err.message : `Unexpected error: ${String((err as Error)?.message ?? err).slice(0, 300)}`, retryable: !isAppError(err) };
  }
}

/** Substitutes variables into an AI prompt, marking substituted data as untrusted. */
function resolvePrompt(template: string, ctx: ExpressionContext): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.[\]-]*)\s*\}\}/g, (_, path: string) => {
    const v = resolveTemplate(`{{${path}}}`, ctx);
    const s = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
    return wrapUntrusted(path, s);
  });
}

async function aiStep(l: Loaded, node: GraphNode, prompt: string, spec: OutputSpec | undefined, cfg: { provider?: string; model?: string }): Promise<NodeOutcome> {
  const { run, state } = l;
  const model = cfg.provider && cfg.model ? { provider: cfg.provider as never, model: cfg.model } : await defaultModelFor(run.orgId);
  const system = `${SYSTEM_SAFETY}\n\nYou are performing one step (“${node.label}”) of the automated workflow “${l.run.workflow.name}” for ${l.ctxBase.company.name}. Be precise and concise.${spec ? " Return only a JSON object matching the schema." : ""}`;
  const messages: { role: "user"; content: { type: "text"; text: string }[] }[] = [{ role: "user", content: [{ type: "text", text: prompt }] }];
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await callModel(
      run.orgId,
      { provider: model.provider, model: model.model, fallbackProvider: null, fallbackModel: null, temperature: 0.2, maxOutputTokens: 3000 },
      { system, messages, responseSchema: spec ? { name: spec.name, schema: outputJsonSchema(spec) } : undefined, offlineHints: { knowledge: [], agentName: "Workflow", taskText: prompt } },
    );
    const cost = estimateCostUsd(res.model, res.usage.inputTokens, res.usage.outputTokens);
    state.counters.tokens += res.usage.inputTokens + res.usage.outputTokens;
    state.counters.costUsd += cost;
    await prisma.usageRecord.create({
      data: { orgId: run.orgId, kind: "AI_TOKENS", workflowRunId: run.id, provider: res.provider, model: res.model, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, costUsd: cost, isSimulation: run.mode === "SIMULATION" },
    });
    if (state.nodes[node.key].stepId) {
      await prisma.workflowRunStep.update({ where: { id: state.nodes[node.key].stepId }, data: { tokens: { increment: res.usage.inputTokens + res.usage.outputTokens }, costUsd: { increment: cost } } });
    }
    if (res.stopReason === "refusal") return { kind: "failed", error: "The AI model declined this step.", retryable: false };
    const text = textOf(res.content);
    if (!spec) return { kind: "completed", output: { text, model: res.model, offline: res.provider === "OFFLINE" } };
    const check = validateOutput(spec, text);
    if (check.ok) return { kind: "completed", output: { ...check.value, offline: res.provider === "OFFLINE" || undefined } };
    messages.push({ role: "user", content: [{ type: "text", text: `That output did not match the schema (${check.error}). Reply with only the corrected JSON object.` }] });
  }
  return { kind: "failed", error: "The AI couldn't produce valid structured output after 3 attempts.", retryable: false };
}

async function startAgentStep(l: Loaded, node: GraphNode, agentId: string, instructions: string, spec: OutputSpec | null, loop?: unknown): Promise<NodeOutcome> {
  if (loop) return { kind: "failed", error: "Employees can't run inside loops.", retryable: false };
  const { run } = l;
  const agent = await prisma.agent.findFirst({ where: { id: agentId, orgId: run.orgId, deletedAt: null } });
  if (!agent) return { kind: "failed", error: "The AI employee for this step no longer exists.", retryable: false };
  const { createTask } = await import("@/server/services/tasks");
  const { queueAgentRun } = await import("@/server/runtime/agent-runtime");
  const task = await createTask(
    { orgId: run.orgId, type: "SYSTEM" },
    { title: node.label, description: instructions.slice(0, 4000), agentId, mode: run.mode, workflowId: run.workflowId, workflowRunId: run.id },
  );
  const agentRun = await queueAgentRun(run.orgId, agentId, {
    input: instructions,
    mode: run.mode,
    taskId: task.id,
    workflowRunId: run.id,
    workflowNodeKey: node.key,
    outputSpec: spec,
    workflowContext: `This is step “${node.label}” of the workflow “${l.run.workflow.name}”. Workflow run: ${run.id}.`,
    useDraft: run.mode === "SIMULATION",
  });
  const ns = l.state.nodes[node.key];
  if (ns.stepId) await prisma.workflowRunStep.update({ where: { id: ns.stepId }, data: { agentRunId: agentRun.id, input: { instructions: instructions.slice(0, 2000) } as Prisma.InputJsonValue } });
  return { kind: "waiting", waitingOn: { kind: "agent_run", id: agentRun.id } };
}

async function toolStep(
  l: Loaded,
  node: GraphNode,
  toolKey: string,
  input: Record<string, unknown>,
  agentId: string | null,
  loop: { index: number } | undefined,
  approvalId: string | undefined,
): Promise<NodeOutcome> {
  const { run, state } = l;
  state.counters.toolCalls++;
  const ns = state.nodes[node.key];
  if (ns.stepId && !approvalId) await prisma.workflowRunStep.update({ where: { id: ns.stepId }, data: { input: redact(input) as Prisma.InputJsonValue } });
  const outcome = await executeTool({
    orgId: run.orgId,
    agentId,
    runId: null,
    workflowRunId: run.id,
    toolKey,
    input,
    mode: run.mode,
    idempotencyKey: `${run.id}:${node.key}${loop ? `:${loop.index}` : ""}`,
    approvalId,
  });
  switch (outcome.status) {
    case "EXECUTED":
    case "SIMULATED":
      return { kind: "completed", output: outcome.result.output };
    case "DENIED":
      return { kind: "failed", error: outcome.error, retryable: false };
    case "FAILED":
      return { kind: "failed", error: outcome.error, retryable: outcome.retryable };
    case "REQUIRES_APPROVAL": {
      if (run.mode === "SIMULATION") {
        const preview = await executeTool({ orgId: run.orgId, agentId: null, runId: null, workflowRunId: run.id, toolKey, input: outcome.input, mode: "SIMULATION", idempotencyKey: `${run.id}:${node.key}:sim` });
        return {
          kind: "completed",
          output: { simulated: true, wouldRequireApproval: true, reasons: outcome.decision.reasons, preview: preview.status === "SIMULATED" ? preview.result.output : null },
        };
      }
      if (loop) return { kind: "failed", error: `${outcome.tool.name} needs approval, which isn't possible inside a loop.`, retryable: false };
      const agent = agentId ? await prisma.agent.findUnique({ where: { id: agentId }, select: { name: true } }) : null;
      const approval = await createApproval({
        orgId: run.orgId,
        kind: "TOOL_ACTION",
        title: `${agent?.name ?? "Workflow"} wants to: ${outcome.tool.name}`,
        summary: `Workflow “${l.run.workflow.name}” · step “${node.label}”`,
        agentId,
        workflowRunId: run.id,
        workflowStepId: ns.stepId ?? null,
        toolKey,
        toolName: outcome.tool.name,
        riskLevel: outcome.riskLevel,
        proposedInput: outcome.input,
        reasons: outcome.decision.reasons,
      });
      if (ns.stepId) await prisma.workflowRunStep.update({ where: { id: ns.stepId }, data: { approvalId: approval.id } });
      return { kind: "waiting", waitingOn: { kind: "approval", id: approval.id } };
    }
  }
}

async function loopStep(l: Loaded, node: GraphNode, cfg: { items: string; maxItems: number; itemVar: string }): Promise<NodeOutcome> {
  const { graph, state } = l;
  const raw = resolveTemplate(cfg.items, exprCtx(l));
  if (!Array.isArray(raw)) return { kind: "failed", error: `“${cfg.items}” is not a list.`, retryable: false };
  const items = raw.slice(0, cfg.maxItems);
  const body = loopBody(graph, node.key);
  // Execution order inside the body: follow edges from "each".
  const order: string[] = [];
  const queue = outgoing(graph, node.key, "each").map((e) => e.target);
  while (queue.length) {
    const k = queue.shift()!;
    if (order.includes(k) || !body.includes(k)) continue;
    if (incoming(graph, k).some((e) => body.includes(e.source) && !order.includes(e.source))) {
      queue.push(k);
      continue;
    }
    order.push(k);
    for (const e of outgoing(graph, k)) queue.push(e.target);
  }
  const results: unknown[] = [];
  let failures = 0;
  for (let i = 0; i < items.length; i++) {
    state.vars[cfg.itemVar] = items[i];
    let last: unknown = null;
    for (const key of order) {
      const bodyNode = graph.nodes.find((n) => n.key === key)!;
      const outcome = await runNode(l, bodyNode, { index: i, item: items[i] });
      if (outcome.kind === "failed") {
        failures++;
        last = { error: outcome.error };
        break;
      }
      if (outcome.kind === "waiting") {
        failures++;
        last = { error: "This step can't wait inside a loop." };
        break;
      }
      state.nodes[key] = { ...state.nodes[key], status: "COMPLETED", output: outcome.output };
      last = outcome.output;
      if (bodyNode.type === "logic.filter" && outcome.handles?.length === 0) break;
    }
    results.push(last);
    if (limitProblem(l, l.settings)) break;
  }
  delete state.vars[cfg.itemVar];
  return { kind: "completed", output: { items: results, count: results.length, failures }, handles: ["done"] };
}

async function resolveWaiting(l: Loaded, node: GraphNode, ns: NodeState): Promise<NodeOutcome | null> {
  const w = ns.waitingOn!;
  if (w.kind === "delay") return w.resumeAt && Date.now() >= new Date(w.resumeAt).getTime() ? { kind: "completed", output: { waitedUntil: w.resumeAt } } : null;
  if (w.kind === "retry") {
    if (!w.resumeAt || Date.now() < new Date(w.resumeAt).getTime()) return null;
    ns.status = "PENDING";
    ns.waitingOn = undefined;
    // Re-run immediately; readyNodes will pick it up (edges into it are already resolved).
    return runNode(l, node);
  }
  if (w.kind === "agent_run" && w.id) {
    const ar = await prisma.agentRun.findUnique({ where: { id: w.id } });
    if (!ar) return { kind: "failed", error: "The employee's run disappeared.", retryable: false };
    if (ar.status === "COMPLETED") {
      l.state.counters.tokens += ar.inputTokens + ar.outputTokens;
      l.state.counters.costUsd += ar.costUsd;
      const structured = (ar.structuredOutput as Record<string, unknown> | null) ?? {};
      return { kind: "completed", output: { ...structured, text: ar.output ?? "", runId: ar.id } };
    }
    if (ar.status === "FAILED" || ar.status === "CANCELLED") return { kind: "failed", error: ar.error ?? `The employee's run ${ar.status.toLowerCase()}.`, retryable: false };
    return null;
  }
  if (w.kind === "approval" && w.id) {
    const a = await prisma.approval.findUnique({ where: { id: w.id } });
    if (!a || a.status === "PENDING") return null;
    const approved = a.status === "APPROVED" || a.status === "ANSWERED";
    if (node.type === "tool.call") {
      if (!approved) return { kind: "failed", error: `A human ${a.status === "REJECTED" ? "rejected" : "didn't approve"} “${node.label}”.`, retryable: false, rejected: true };
      const c = node.config as { toolKey: string; agentId?: string };
      const input = (a.editedInput ?? a.proposedInput) as Record<string, unknown>;
      return toolStep(l, node, c.toolKey, input, c.agentId ?? l.settings.defaultAgentId ?? null, undefined, a.id);
    }
    if (node.type === "human.input") {
      return a.status === "ANSWERED" ? { kind: "completed", output: { answer: a.response } } : { kind: "failed", error: "The input request was dismissed.", retryable: false, rejected: true };
    }
    // Approval / review
    const content = (a.editedInput as { content?: string } | null)?.content ?? (a.proposedInput as { content?: string } | null)?.content;
    return {
      kind: "completed",
      output: { approved, decision: a.status.toLowerCase(), note: a.decisionNote, content, decidedById: a.decidedById },
      handles: [approved ? "approved" : "rejected"],
    };
  }
  return null;
}

// ── Completion ──────────────────────────────────────────────────────────────

async function failRun(l: Loaded, reason: string) {
  // A failed test is shown on the run page the user is watching — don't page anyone about it.
  if (l.run.mode === "SIMULATION") return finishRun(l, "FAILED", reason);
  await createApproval({
    orgId: l.run.orgId,
    kind: "ESCALATION",
    title: `Workflow “${l.run.workflow.name}” stopped: ${reason}`.slice(0, 200),
    question: `${reason}\n\nRun: ${l.run.id}. Inspect the run, fix the cause and run it again.`,
    workflowRunId: l.run.id,
  });
  return finishRun(l, "FAILED", reason);
}

async function finishRun(l: Loaded, status: "COMPLETED" | "FAILED" | "CANCELLED", note?: string) {
  const { run, state } = l;
  for (const [k, s] of Object.entries(state.nodes)) {
    if (s.status === "PENDING" || s.status === "WAITING" || s.status === "RUNNING") {
      state.nodes[k] = { ...s, status: "SKIPPED", waitingOn: undefined };
      if (s.stepId) await updateStep(s.stepId, "CANCELLED");
    }
  }
  const output = state.results.__end ?? (Object.keys(state.results).length ? state.results : null);
  await persist(l, {
    status,
    completedAt: new Date(),
    error: status === "COMPLETED" ? null : (note ?? null),
    output: (output ?? undefined) as Prisma.InputJsonValue | undefined,
    progress: status === "COMPLETED" ? 100 : undefined,
  });
  const sim = run.mode === "SIMULATION";
  if (sim && status === "COMPLETED") {
    // A successful simulation of the exact draft unlocks publishing (Draft → Test → Publish).
    await prisma.workflowVersion.updateMany({ where: { id: run.versionId, status: "DRAFT", updatedAt: { lte: run.createdAt } }, data: { lastSimulationOk: true } });
  }
  await recordActivity({
    orgId: run.orgId,
    category: "WORKFLOW",
    actorType: "SYSTEM",
    summary: `${sim ? "Simulation of " : ""}${run.workflow.name} ${status === "COMPLETED" ? (note ? "stopped" : "completed") : status === "FAILED" ? "failed" : "was cancelled"}.`,
    detail: note ?? `${state.counters.steps} steps.`,
    entityType: "WorkflowRun",
    entityId: run.id,
    link: `/workflows/runs/${run.id}`,
    isSimulation: sim,
  });
  await writeAudit({
    orgId: run.orgId,
    actorType: "SYSTEM",
    action: `workflow.run.${status.toLowerCase()}`,
    entityType: "WorkflowRun",
    entityId: run.id,
    workflowRunId: run.id,
    outcome: status === "FAILED" ? "FAILED" : "SUCCESS",
    metadata: { steps: state.counters.steps, tokens: state.counters.tokens, costUsd: state.counters.costUsd, note },
  });
  if (run.createdById && status !== "CANCELLED") {
    await notifyUser(run.orgId, run.createdById, {
      type: status === "COMPLETED" ? "workflow_completed" : "workflow_failed",
      title: `${sim ? "Simulation: " : ""}${run.workflow.name} ${status === "COMPLETED" ? "finished" : "failed"}`,
      body: note,
      link: `/workflows/runs/${run.id}`,
    });
  }
  await syncTask(l, status);
}

async function syncTask(l: Loaded, status: "COMPLETED" | "FAILED" | "CANCELLED" | "AWAITING_APPROVAL" | "WAITING") {
  if (!l.run.taskId) return;
  await prisma.task.updateMany({ where: { id: l.run.taskId }, data: { status, progress: status === "COMPLETED" ? 100 : undefined } });
}

async function updateStep(stepId: string, status: StepStatus, output?: unknown, error?: string) {
  await prisma.workflowRunStep.update({
    where: { id: stepId },
    data: {
      status,
      output: output === undefined ? undefined : (output as Prisma.InputJsonValue),
      error: error?.slice(0, 1000),
      completedAt: ["SUCCEEDED", "FAILED", "DENIED", "CANCELLED", "SKIPPED"].includes(status) ? new Date() : null,
    },
  });
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

