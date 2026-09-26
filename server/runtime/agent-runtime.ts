import { startOfMonth } from "date-fns";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ExecutionMode, RunStatus, RunStepType, StepStatus } from "@/lib/generated/prisma/enums";
import { AppError, isAppError } from "@/lib/errors";
import type { AgentSnapshot } from "@/lib/agents/snapshot";
import { callModel } from "@/lib/ai/router";
import { estimateCostUsd } from "@/lib/ai/models";
import { textOf, toolCallsOf, toFunctionName, type AIMessage, type AIToolDefinition, type ContentPart, type KnowledgeHint } from "@/lib/ai/types";
import { outputJsonSchema, validateOutput, type OutputSpec } from "@/lib/ai/output-spec";
import { redact, summarizeForLog } from "@/lib/security/redact";
import { resolveRunSnapshot } from "@/server/services/agents";
import { buildAgentContext, sourceLabel, wrapUntrusted } from "@/server/runtime/context-builder";
import { PLATFORM_TOOL_NAMES, platformToolDefinitions } from "@/server/runtime/platform-tools";
import { executeTool, toolInputJsonSchema } from "@/server/tools/executor";
import { createApproval } from "@/server/services/approvals";
import { searchKnowledge } from "@/server/services/knowledge-search";
import { addMemory } from "@/server/services/memory";
import { recordActivity, writeAudit } from "@/server/services/audit";
import { enqueue } from "@/server/jobs/queue";

/**
 * AgentRuntime (spec §48)
 *   ContextBuilder · KnowledgeService · MemoryService · ToolRegistry ·
 *   PermissionEngine · PolicyEngine · ModelRouter · Executor · RetryManager ·
 *   EscalationManager · CostTracker · AuditLogger
 *
 * A run is a persisted state machine. It can pause (approval, question,
 * escalation) and resume later in any process — nothing depends on a browser.
 */

export interface RunRequest {
  input: string;
  mode: ExecutionMode;
  conversationId?: string | null;
  taskId?: string | null;
  workflowRunId?: string | null;
  workflowNodeKey?: string | null;
  parentRunId?: string | null;
  depth?: number;
  outputSpec?: OutputSpec | null;
  taskInstructions?: string | null;
  workflowContext?: string | null;
  useDraft?: boolean;
  history?: AIMessage[];
}

export interface Citation {
  label: string;
  documentId: string;
  title: string;
  page: number | null;
  excerpt: string;
}

interface PendingAction {
  kind: "approval" | "question" | "escalation";
  approvalId: string;
  toolCallId: string | null;
  fnName: string | null;
  toolKey: string | null;
  input: Record<string, unknown>;
  stepId: string;
}

type ToolCall = Extract<ContentPart, { type: "tool_call" }>;
type ToolResultPart = Extract<ContentPart, { type: "tool_result" }>;

interface RunState {
  v: 1;
  request: Omit<RunRequest, "history">;
  snapshot: AgentSnapshot;
  system: string;
  messages: AIMessage[];
  tools: AIToolDefinition[];
  toolMap: Record<string, string>;
  hints: KnowledgeHint[];
  allowedKbIds: string[];
  counters: { steps: number; toolCalls: number; inputTokens: number; outputTokens: number; costUsd: number; failures: number; repairs: number };
  turn?: { calls: ToolCall[]; results: ToolResultPart[]; index: number };
  pending?: PendingAction;
  seq: number;
  startedAt: number;
}

const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_DELEGATION_DEPTH = 2;

// ── Public API ──────────────────────────────────────────────────────────────

/** Creates a queued run. Execution happens via `executeAgentRun` (usually in the worker). */
export async function createAgentRun(orgId: string, agentId: string, req: RunRequest) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, orgId, deletedAt: null }, include: { organization: { select: { suspendedAt: true } } } });
  if (!agent) throw new AppError("NOT_FOUND", "AI employee not found.");
  if (agent.organization.suspendedAt) throw new AppError("FORBIDDEN", "This company workspace is suspended, so nothing new can run.");
  return prisma.agentRun.create({
    data: {
      orgId,
      agentId,
      status: "QUEUED",
      mode: req.mode,
      input: req.input.slice(0, 20000),
      conversationId: req.conversationId ?? null,
      taskId: req.taskId ?? null,
      workflowRunId: req.workflowRunId ?? null,
      workflowNodeKey: req.workflowNodeKey ?? null,
      parentRunId: req.parentRunId ?? null,
      state: { queued: { request: { ...req, history: undefined }, history: req.history ?? [] } } as unknown as Prisma.InputJsonValue,
    },
  });
}

/** Creates a run and schedules it on the background queue. */
export async function queueAgentRun(orgId: string, agentId: string, req: RunRequest) {
  const run = await createAgentRun(orgId, agentId, req);
  await enqueue("agent.execute", { runId: run.id }, { orgId, dedupeKey: `run-exec:${run.id}` });
  return run;
}

/** Runs to completion (or pause) in the current process — delegation and tests. */
export async function runAgentInline(orgId: string, agentId: string, req: RunRequest) {
  const run = await createAgentRun(orgId, agentId, req);
  await executeAgentRun(run.id);
  return prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
}

export async function executeAgentRun(runId: string) {
  // Compare-and-set: only one worker may start a queued run.
  const claimed = await prisma.agentRun.updateMany({ where: { id: runId, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date() } });
  if (claimed.count === 0) return;
  const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
  const queued = (run.state as { queued?: { request: RunRequest; history: AIMessage[] } }).queued;
  if (!queued) return finish(run.id, null, "FAILED", { error: "Run has no request." });

  let state: RunState;
  try {
    state = await initialise(run.orgId, run.agentId, run.id, queued.request, queued.history);
  } catch (err) {
    const message = isAppError(err) ? err.message : "Could not start the run.";
    if (!isAppError(err)) console.error("[runtime] init failed", err);
    return finish(run.id, null, "FAILED", { error: message });
  }
  await loop(run.id, run.orgId, run.agentId, state);
}

/** Continues a paused run after an approval decision, an answer, or a dismissal. */
export async function resumeAgentRun(runId: string, approvalId: string) {
  const claimed = await prisma.agentRun.updateMany({ where: { id: runId, status: { in: ["AWAITING_APPROVAL", "WAITING"] } }, data: { status: "RUNNING" } });
  if (claimed.count === 0) return;
  const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
  const state = run.state as unknown as RunState;
  const pending = state.pending;
  if (!pending || pending.approvalId !== approvalId) {
    await prisma.agentRun.update({ where: { id: runId }, data: { status: run.status === "RUNNING" ? "WAITING" : run.status } });
    return;
  }
  const approval = await prisma.approval.findUniqueOrThrow({ where: { id: approvalId } });
  state.pending = undefined;
  await setAgentStatus(run.agentId, "WORKING", state.request.input);
  await hookTaskStatus(run.taskId, "RUNNING");

  if (pending.kind === "escalation") {
    await completeStep(pending.stepId, approval.status === "ANSWERED" ? "SUCCEEDED" : "CANCELLED", { response: approval.response });
    if (approval.status !== "ANSWERED") return finish(runId, state, "CANCELLED", { error: "The escalation was dismissed." });
    state.counters.failures = 0;
    state.messages.push({ role: "user", content: [{ type: "text", text: `Guidance from your human manager: ${approval.response}` }] });
    return loop(runId, run.orgId, run.agentId, state);
  }

  let result: ToolResultPart;
  if (pending.kind === "question") {
    const answered = approval.status === "ANSWERED";
    await completeStep(pending.stepId, answered ? "SUCCEEDED" : "CANCELLED", { answered });
    result = {
      type: "tool_result",
      toolCallId: pending.toolCallId!,
      name: pending.fnName!,
      content: answered ? `Answer from your human manager: ${approval.response}` : "The human dismissed the question without answering. Proceed without it or explain what's missing.",
      isError: !answered,
    };
  } else if (approval.status === "APPROVED") {
    const input = ((approval.editedInput ?? approval.proposedInput) as Record<string, unknown>) ?? pending.input;
    const outcome = await executeTool({
      orgId: run.orgId,
      agentId: run.agentId,
      runId,
      workflowRunId: run.workflowRunId,
      toolKey: pending.toolKey!,
      input,
      mode: run.mode,
      idempotencyKey: `${runId}:${pending.toolCallId}`,
      snapshotGrant: snapshotGrant(state, pending.toolKey!),
      approvalId,
    });
    result = await toolOutcomeToResult(state, pending.stepId, pending.toolCallId!, pending.fnName!, pending.toolKey!, outcome, true, approval.editedInput ? "Approved with edits" : "Approved");
  } else {
    await completeStep(pending.stepId, "DENIED", { decision: approval.status, note: approval.decisionNote });
    result = {
      type: "tool_result",
      toolCallId: pending.toolCallId!,
      name: pending.fnName!,
      content: `A human ${approval.status === "REJECTED" ? "rejected" : "did not approve"} this action.${approval.decisionNote ? ` Their note: ${approval.decisionNote}` : ""} Do not retry it; adapt or report back.`,
      isError: true,
    };
  }
  if (state.turn) {
    state.turn.results.push(result);
    state.turn.index++;
  }
  return loop(runId, run.orgId, run.agentId, state);
}

export async function cancelAgentRun(orgId: string, runId: string) {
  const run = await prisma.agentRun.findFirst({ where: { id: runId, orgId } });
  if (!run) throw new AppError("NOT_FOUND", "Run not found.");
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) return;
  await prisma.agentRun.update({ where: { id: runId }, data: { status: "CANCELLED", completedAt: new Date(), error: "Cancelled by a human." } });
  await prisma.agentRunStep.updateMany({ where: { runId, status: { in: ["PENDING", "RUNNING", "WAITING", "AWAITING_APPROVAL"] } }, data: { status: "CANCELLED", completedAt: new Date() } });
  await prisma.approval.updateMany({ where: { agentRunId: runId, status: "PENDING" }, data: { status: "CANCELLED" } });
  await setAgentStatus(run.agentId, "ACTIVE", null);
  await hookTaskStatus(run.taskId, "CANCELLED");
}

// ── Initialisation ──────────────────────────────────────────────────────────

async function initialise(orgId: string, agentId: string, runId: string, request: RunRequest, history: AIMessage[]): Promise<RunState> {
  const agent = await prisma.agent.findFirstOrThrow({ where: { id: agentId, orgId } });
  if (agent.status === "PAUSED") throw new AppError("FORBIDDEN", `${agent.name} is paused. Resume them to continue.`);
  if (agent.deletedAt) throw new AppError("FORBIDDEN", `${agent.name} was removed.`);
  if (request.mode === "LIVE" && !request.useDraft && agent.publishedVersion === null) {
    throw new AppError("VALIDATION", `${agent.name} hasn't been published yet. Publish them or run in simulation mode.`);
  }
  const snapshot = await resolveRunSnapshot(orgId, agentId, { useDraft: request.useDraft || request.mode === "SIMULATION" });

  // Authorized external tools (never offer tools the agent can't use).
  const toolRows = await prisma.tool.findMany({
    where: { orgId, deletedAt: null, enabled: true, id: { in: snapshot.tools.filter((t) => t.effect !== "DENY").map((t) => t.toolId) } },
  });
  const live = await prisma.agentTool.findMany({ where: { agentId, toolId: { in: toolRows.map((t) => t.id) }, effect: { not: "DENY" } } });
  const usable = toolRows.filter((t) => live.some((l) => l.toolId === t.id));

  const toolMap: Record<string, string> = {};
  const tools: AIToolDefinition[] = usable.map((t) => {
    const name = toFunctionName(t.key);
    toolMap[name] = t.key;
    return { name, description: `${t.name}: ${t.description}${t.isSimulated ? " (simulated integration)" : ""}`, inputSchema: toolInputJsonSchema(t) };
  });

  const delegates = snapshot.canDelegate
    ? await prisma.agent.findMany({ where: { orgId, id: { in: snapshot.delegateIds }, deletedAt: null, status: { not: "PAUSED" } }, select: { id: true, name: true, jobTitle: true } })
    : [];

  const context = await buildAgentContext({
    orgId,
    agentId,
    snapshot,
    query: request.input,
    taskInstructions: request.taskInstructions,
    workflowContext: request.workflowContext,
    toolNames: usable.map((t) => t.name),
    structuredOutput: !!request.outputSpec,
  });
  const platform = platformToolDefinitions(snapshot, {
    hasKnowledge: context.allowedKbIds.length > 0,
    allowQuestions: !request.parentRunId && request.mode === "LIVE",
    delegates: (request.depth ?? 0) < MAX_DELEGATION_DEPTH ? delegates : [],
  });
  for (const p of platform) toolMap[p.name] = `platform:${p.name}`;

  const state: RunState = {
    v: 1,
    request: { ...request, history: undefined } as Omit<RunRequest, "history">,
    snapshot,
    system: context.system,
    messages: [...history.slice(-20), { role: "user", content: [{ type: "text", text: request.input }] }],
    tools: [...tools, ...platform],
    toolMap,
    hints: context.hints,
    allowedKbIds: context.allowedKbIds,
    counters: { steps: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, failures: 0, repairs: 0 },
    seq: 0,
    startedAt: Date.now(),
  };

  await prisma.agentRun.update({
    where: { id: runId },
    data: { agentVersion: snapshot.version, provider: snapshot.model.provider, model: snapshot.model.model, state: state as unknown as Prisma.InputJsonValue },
  });
  await setAgentStatus(agentId, "WORKING", request.input);
  await hookTaskStatus(request.taskId ?? null, "RUNNING");

  const sources = [...new Set(context.knowledge.map((k) => k.title))];
  const ctxStep = await addStep(runId, orgId, state, "CONTEXT", "Prepared context", "SUCCEEDED", {
    outputMeta: { knowledgeSnippets: context.knowledge.length, memories: context.memoriesUsed, tools: tools.length },
  });
  void ctxStep;
  for (const title of sources) {
    await addStep(runId, orgId, state, "KNOWLEDGE_SEARCH", `Retrieved ${title}`, "SUCCEEDED");
  }
  return state;
}

// ── Main loop ───────────────────────────────────────────────────────────────

async function loop(runId: string, orgId: string, agentId: string, state: RunState): Promise<void> {
  const snapshot = state.snapshot;
  const limits = snapshot.limits;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, RUN_TIMEOUT_MS - (Date.now() - state.startedAt)));
  try {
    while (true) {
      const current = await prisma.agentRun.findUnique({ where: { id: runId }, select: { status: true } });
      if (!current || current.status === "CANCELLED") return;
      if (controller.signal.aborted) return escalate(runId, orgId, agentId, state, "The run hit its time limit.", true);

      // Finish any in-progress tool turn (possibly resumed after approval).
      if (state.turn) {
        const paused = await processToolTurn(runId, orgId, agentId, state);
        if (paused) return;
        state.messages.push({ role: "user", content: state.turn.results });
        state.turn = undefined;
        await persist(runId, state);
        if (state.counters.failures >= 3) {
          return escalate(runId, orgId, agentId, state, "Tools failed repeatedly, so I stopped instead of guessing.");
        }
      }

      // Limits (spec §42)
      if (state.counters.steps >= limits.maxStepsPerRun) return escalate(runId, orgId, agentId, state, `Reached the step limit (${limits.maxStepsPerRun}).`, true);
      if (state.counters.inputTokens + state.counters.outputTokens >= limits.maxTokensPerRun) return escalate(runId, orgId, agentId, state, "Reached the token limit for this run.", true);
      if (state.counters.costUsd >= limits.maxCostPerRunUsd && limits.maxCostPerRunUsd > 0) return escalate(runId, orgId, agentId, state, "Reached the cost limit for this run.", true);
      const budget = await budgetProblem(orgId, agentId, snapshot);
      if (budget) return escalate(runId, orgId, agentId, state, budget, true);

      // Model call
      const wantSchema = !!state.request.outputSpec;
      const modelStep = await addStep(runId, orgId, state, "MODEL_CALL", "Deciding next step", "RUNNING");
      const started = Date.now();
      let res;
      try {
        res = await callModel(orgId, snapshot.model, {
          system: state.system,
          messages: state.messages,
          tools: state.tools,
          responseSchema: wantSchema ? { name: state.request.outputSpec!.name, schema: outputJsonSchema(state.request.outputSpec!) } : undefined,
          signal: controller.signal,
          offlineHints: { knowledge: state.hints, agentName: snapshot.name, taskText: state.request.input },
        });
      } catch (err) {
        const message = isAppError(err) ? err.message : `The AI provider failed: ${String((err as Error)?.message ?? err).slice(0, 300)}`;
        await completeStep(modelStep, "FAILED", undefined, message, Date.now() - started);
        return finish(runId, state, "FAILED", { error: message });
      }
      const cost = estimateCostUsd(res.model, res.usage.inputTokens, res.usage.outputTokens);
      state.counters.steps++;
      state.counters.inputTokens += res.usage.inputTokens;
      state.counters.outputTokens += res.usage.outputTokens;
      state.counters.costUsd += cost;
      await prisma.usageRecord.create({
        data: {
          orgId,
          kind: "AI_TOKENS",
          agentId,
          runId,
          workflowRunId: state.request.workflowRunId ?? undefined,
          provider: res.provider,
          model: res.model,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          costUsd: cost,
          isSimulation: state.request.mode === "SIMULATION",
        },
      });
      const calls = toolCallsOf(res.content);
      await completeStep(modelStep, "SUCCEEDED", { model: res.model, fallback: res.usedFallback, stop: res.stopReason }, undefined, Date.now() - started, {
        label: calls.length ? "Decided next action" : "Prepared response",
        tokens: res.usage.inputTokens + res.usage.outputTokens,
        costUsd: cost,
      });
      state.messages.push({ role: "assistant", content: res.content, providerData: res.providerData ? { provider: res.provider, model: res.model, raw: res.providerData } : undefined });

      if (res.stopReason === "refusal") {
        return escalate(runId, orgId, agentId, state, `The AI model declined this request${res.refusalCategory ? ` (${res.refusalCategory})` : ""}. A human should review it.`);
      }

      if (calls.length > 0) {
        if (state.counters.toolCalls + calls.length > limits.maxToolCallsPerRun) {
          return escalate(runId, orgId, agentId, state, `Reached the tool-call limit (${limits.maxToolCallsPerRun}).`, true);
        }
        state.turn = { calls, results: [], index: 0 };
        await persist(runId, state);
        continue;
      }

      const text = textOf(res.content);
      if (res.stopReason === "max_tokens" && !text) {
        return finish(runId, state, "FAILED", { error: "The response was cut off (output token limit). Increase the max output tokens for this employee." });
      }

      if (state.request.outputSpec) {
        const check = validateOutput(state.request.outputSpec, text);
        if (!check.ok) {
          if (state.counters.repairs < 2) {
            state.counters.repairs++;
            state.messages.push({ role: "user", content: [{ type: "text", text: `Your output did not match the required JSON schema (${check.error}). Reply with only the corrected JSON object.` }] });
            await addStep(runId, orgId, state, "OUTPUT", "Repairing structured output", "SUCCEEDED", { outputMeta: { error: check.error } });
            await persist(runId, state);
            continue;
          }
          return escalate(runId, orgId, agentId, state, `The AI couldn't produce valid structured output: ${check.error}`);
        }
        await addStep(runId, orgId, state, "OUTPUT", "Validated structured output", "SUCCEEDED");
        return finish(runId, state, "COMPLETED", { output: text, structured: check.value });
      }
      return finish(runId, state, "COMPLETED", { output: text });
    }
  } catch (err) {
    console.error("[runtime] run crashed", runId, err);
    return finish(runId, state, "FAILED", { error: isAppError(err) ? err.message : "The run failed unexpectedly. Our team has been notified in the logs." });
  } finally {
    clearTimeout(timer);
  }
}

/** Executes the remaining calls of the current turn. Returns true if the run paused. */
async function processToolTurn(runId: string, orgId: string, agentId: string, state: RunState): Promise<boolean> {
  const turn = state.turn!;
  while (turn.index < turn.calls.length) {
    const call = turn.calls[turn.index];
    const key = state.toolMap[call.name];
    state.counters.toolCalls++;

    if (!key) {
      turn.results.push({ type: "tool_result", toolCallId: call.id, name: call.name, content: `Unknown tool "${call.name}". Use only the tools you were given.`, isError: true });
      turn.index++;
      continue;
    }

    if (key.startsWith("platform:")) {
      const outcome = await runPlatformTool(runId, orgId, agentId, state, call);
      if (outcome === "paused") return true;
      turn.results.push(outcome);
      turn.index++;
      await persist(runId, state);
      continue;
    }

    const tool = await prisma.tool.findFirst({ where: { orgId, key }, select: { name: true } });
    const stepId = await addStep(runId, orgId, state, "TOOL_CALL", tool?.name ?? key, "RUNNING", { toolKey: key, input: summarizeForLog(call.input) });
    const outcome = await executeTool({
      orgId,
      agentId,
      runId,
      workflowRunId: state.request.workflowRunId,
      toolKey: key,
      input: call.input,
      mode: state.request.mode,
      idempotencyKey: `${runId}:${call.id}`,
      snapshotGrant: snapshotGrant(state, key),
    });

    if (outcome.status === "REQUIRES_APPROVAL") {
      if (state.request.mode === "SIMULATION") {
        // Simulation: show what would need approval, never create a real request.
        const preview = await executeTool({
          orgId,
          agentId: null,
          runId,
          toolKey: key,
          input: outcome.input,
          mode: "SIMULATION",
          idempotencyKey: `${runId}:${call.id}:sim`,
        });
        const summary = preview.status === "SIMULATED" ? preview.result.summary : "Would run";
        await completeStep(stepId, "AWAITING_APPROVAL", { simulated: true, summary: `${summary} — would require approval: ${outcome.decision.reasons.join(" ")}` });
        turn.results.push({
          type: "tool_result",
          toolCallId: call.id,
          name: call.name,
          content: wrapUntrusted(`tool:${key}`, JSON.stringify({ simulation: true, wouldRequireApproval: true, reasons: outcome.decision.reasons, preview: summary })),
        });
        turn.index++;
        continue;
      }
      const approval = await createApproval({
        orgId,
        kind: "TOOL_ACTION",
        title: `${state.snapshot.name} wants to: ${outcome.tool.name}`,
        summary: state.request.input.slice(0, 500),
        agentId,
        taskId: state.request.taskId,
        agentRunId: runId,
        workflowRunId: state.request.workflowRunId,
        toolKey: key,
        toolName: outcome.tool.name,
        riskLevel: outcome.riskLevel,
        proposedInput: outcome.input,
        reasons: outcome.decision.reasons,
      });
      await completeStep(stepId, "AWAITING_APPROVAL", { reasons: outcome.decision.reasons }, undefined, undefined, { approvalId: approval.id, label: `Waiting for approval: ${outcome.tool.name}` });
      state.pending = { kind: "approval", approvalId: approval.id, toolCallId: call.id, fnName: call.name, toolKey: key, input: outcome.input, stepId };
      await pause(runId, orgId, agentId, state, "AWAITING_APPROVAL", `${state.snapshot.name} needs approval to ${outcome.tool.name.toLowerCase()}.`, approval.id);
      return true;
    }

    turn.results.push(await toolOutcomeToResult(state, stepId, call.id, call.name, key, outcome, false));
    turn.index++;
    await persist(runId, state);
  }
  return false;
}

async function toolOutcomeToResult(
  state: RunState,
  stepId: string,
  toolCallId: string,
  fnName: string,
  key: string,
  outcome: Awaited<ReturnType<typeof executeTool>>,
  afterApproval: boolean,
  approvalNote?: string,
): Promise<ToolResultPart> {
  if (outcome.status === "EXECUTED" || outcome.status === "SIMULATED") {
    await completeStep(stepId, "SUCCEEDED", {
      summary: outcome.result.summary,
      simulated: outcome.result.simulated || outcome.status === "SIMULATED",
      deduplicated: "deduplicated" in outcome ? outcome.deduplicated : undefined,
      approval: afterApproval ? approvalNote : undefined,
    });
    state.counters.failures = 0;
    const payload = JSON.stringify(outcome.result.output ?? null).slice(0, 20000);
    return { type: "tool_result", toolCallId, name: fnName, content: wrapUntrusted(`tool:${key}`, payload) };
  }
  if (outcome.status === "DENIED") {
    await completeStep(stepId, "DENIED", { reasons: outcome.decision.reasons }, outcome.error);
    return { type: "tool_result", toolCallId, name: fnName, content: `DENIED by the platform: ${outcome.error} Do not retry this action; explain the limitation or ask a human.`, isError: true };
  }
  if (outcome.status === "FAILED") {
    state.counters.failures++;
    await completeStep(stepId, "FAILED", undefined, outcome.error);
    return { type: "tool_result", toolCallId, name: fnName, content: `ERROR: ${outcome.error}`, isError: true };
  }
  // REQUIRES_APPROVAL after an approval means the approval didn't match (e.g. input changed).
  await completeStep(stepId, "DENIED", undefined, "Approval no longer matches this action.");
  return { type: "tool_result", toolCallId, name: fnName, content: "The approval did not match this exact action, so it was not executed.", isError: true };
}

async function runPlatformTool(runId: string, orgId: string, agentId: string, state: RunState, call: ToolCall): Promise<ToolResultPart | "paused"> {
  const input = call.input ?? {};
  const ok = (content: string): ToolResultPart => ({ type: "tool_result", toolCallId: call.id, name: call.name, content });
  const fail = (content: string): ToolResultPart => ({ type: "tool_result", toolCallId: call.id, name: call.name, content, isError: true });

  switch (call.name) {
    case PLATFORM_TOOL_NAMES.searchKnowledge: {
      const query = String(input.query ?? "").slice(0, 500);
      const hits = await searchKnowledge(orgId, state.allowedKbIds, query, 5);
      const start = state.hints.length;
      hits.forEach((h) => state.hints.push({ source: `[${sourceLabel(state.hints.length)}] ${h.title}`, documentId: h.documentId, page: h.pageNumber, content: h.content }));
      await addStep(runId, orgId, state, "KNOWLEDGE_SEARCH", hits.length ? `Searched knowledge: ${[...new Set(hits.map((h) => h.title))].join(", ")}` : "Searched knowledge (no matches)", "SUCCEEDED", {
        outputMeta: { query, results: hits.length },
      });
      if (!hits.length) return ok("No approved knowledge matched this query.");
      return ok(hits.map((h, i) => `[${sourceLabel(start + i)}] ${h.title}${h.pageNumber ? ` p.${h.pageNumber}` : ""}\n${wrapUntrusted(`knowledge:${h.title}`, h.content)}`).join("\n\n"));
    }
    case PLATFORM_TOOL_NAMES.remember: {
      const fact = String(input.fact ?? "").trim();
      if (fact.length < 3) return fail("Nothing to remember.");
      if (state.request.mode === "SIMULATION") {
        await addStep(runId, orgId, state, "MEMORY", "Would remember a fact (simulation)", "SUCCEEDED", { outputMeta: { fact: fact.slice(0, 200) } });
        return ok("Simulation: memory not saved.");
      }
      await addMemory({ orgId, agentId, type: "AGENT" }, { agentId, content: fact, scope: "LONG_TERM", sourceType: "agent", sourceId: runId });
      await addStep(runId, orgId, state, "MEMORY", "Saved a long-term memory", "SUCCEEDED", { outputMeta: { fact: fact.slice(0, 200) } });
      return ok("Saved to long-term memory.");
    }
    case PLATFORM_TOOL_NAMES.askHuman: {
      const question = String(input.question ?? "").trim().slice(0, 2000);
      if (!question) return fail("Ask a specific question.");
      const approval = await createApproval({
        orgId,
        kind: "QUESTION",
        title: question.slice(0, 200),
        question,
        summary: state.request.input.slice(0, 500),
        agentId,
        taskId: state.request.taskId,
        agentRunId: runId,
        workflowRunId: state.request.workflowRunId,
      });
      const stepId = await addStep(runId, orgId, state, "QUESTION", "Asked a question", "WAITING", { approvalId: approval.id, outputMeta: { question } });
      state.pending = { kind: "question", approvalId: approval.id, toolCallId: call.id, fnName: call.name, toolKey: null, input, stepId };
      await pause(runId, orgId, agentId, state, "WAITING", `${state.snapshot.name} asked: ${question}`, approval.id);
      return "paused";
    }
    case PLATFORM_TOOL_NAMES.escalate: {
      await escalate(runId, orgId, agentId, state, String(input.reason ?? "The employee escalated this work.").slice(0, 1000));
      return "paused";
    }
    case PLATFORM_TOOL_NAMES.delegate: {
      const name = String(input.employee ?? "").trim().toLowerCase();
      const task = String(input.task ?? "").trim();
      const delegate = await prisma.agent.findFirst({ where: { orgId, id: { in: state.snapshot.delegateIds }, deletedAt: null, name: { equals: name, mode: "insensitive" } } });
      if (!delegate || !state.snapshot.canDelegate) return fail("You are not permitted to delegate to that employee.");
      if ((state.request.depth ?? 0) >= MAX_DELEGATION_DEPTH) return fail("Delegation depth limit reached.");
      if (!task) return fail("Describe the task to delegate.");
      const stepId = await addStep(runId, orgId, state, "DELEGATION", `Delegated to ${delegate.name}`, "RUNNING", { outputMeta: { task: task.slice(0, 300) } });
      const sub = await runAgentInline(orgId, delegate.id, {
        input: task,
        mode: state.request.mode,
        parentRunId: runId,
        depth: (state.request.depth ?? 0) + 1,
        taskId: null,
        workflowRunId: state.request.workflowRunId,
        useDraft: state.request.useDraft,
      });
      await recordActivity({
        orgId,
        category: "AGENT",
        actorType: "AGENT",
        actorAgentId: agentId,
        summary: `${state.snapshot.name} delegated work to ${delegate.name}.`,
        detail: task.slice(0, 200),
        isSimulation: state.request.mode === "SIMULATION",
      });
      if (sub.status === "COMPLETED") {
        await completeStep(stepId, "SUCCEEDED", { subRunId: sub.id, summary: `${delegate.name} finished` });
        return ok(wrapUntrusted(`colleague:${delegate.name}`, sub.output ?? "(no output)"));
      }
      await completeStep(stepId, sub.status === "AWAITING_APPROVAL" || sub.status === "WAITING" ? "WAITING" : "FAILED", { subRunId: sub.id }, sub.error ?? undefined);
      return fail(
        sub.status === "AWAITING_APPROVAL" || sub.status === "WAITING"
          ? `${delegate.name} is waiting on a human (run ${sub.id}). Continue with what you have and mention the pending work.`
          : `${delegate.name} could not complete the task: ${sub.error ?? sub.status}`,
      );
    }
    default:
      return fail("Unknown platform tool.");
  }
}

// ── Escalation, pausing and completion ─────────────────────────────────────

async function escalate(runId: string, orgId: string, agentId: string, state: RunState, reason: string, terminal = false) {
  const approval = await createApproval({
    orgId,
    kind: "ESCALATION",
    title: `${state.snapshot.name} escalated: ${reason}`.slice(0, 200),
    question: `${reason}\n\nOriginal request: ${state.request.input.slice(0, 1000)}`,
    agentId,
    taskId: state.request.taskId,
    agentRunId: terminal ? null : runId,
    workflowRunId: state.request.workflowRunId,
    isSimulation: state.request.mode === "SIMULATION",
  });
  const stepId = await addStep(runId, orgId, state, "ESCALATION", "Escalated to a human", terminal ? "FAILED" : "WAITING", { approvalId: approval.id, outputMeta: { reason } });
  await prisma.agentRun.update({ where: { id: runId }, data: { escalated: true } });
  if (terminal) return finish(runId, state, "FAILED", { error: reason });
  state.pending = { kind: "escalation", approvalId: approval.id, toolCallId: null, fnName: null, toolKey: null, input: {}, stepId };
  await pause(runId, orgId, agentId, state, "WAITING", reason, approval.id);
}

async function pause(runId: string, orgId: string, agentId: string, state: RunState, status: RunStatus, message: string, approvalId: string) {
  await prisma.agentRun.update({ where: { id: runId }, data: { status, state: state as unknown as Prisma.InputJsonValue, ...usageFields(state) } });
  await setAgentStatus(agentId, status === "AWAITING_APPROVAL" ? "APPROVAL" : "WAITING", message);
  await hookTaskStatus(state.request.taskId ?? null, status === "AWAITING_APPROVAL" ? "AWAITING_APPROVAL" : "WAITING", message);
  if (state.request.conversationId) {
    await prisma.message.create({
      data: {
        orgId,
        conversationId: state.request.conversationId,
        role: "AGENT",
        content: message,
        runId,
        metadata: { kind: status === "AWAITING_APPROVAL" ? "approval" : "question", approvalId, offline: state.snapshot.model.provider === "OFFLINE" },
      },
    });
    await prisma.conversation.update({ where: { id: state.request.conversationId }, data: { lastMessageAt: new Date() } });
  }
  if (state.request.workflowRunId) {
    await enqueue("workflow.advance", { workflowRunId: state.request.workflowRunId, agentRunId: runId }, { orgId });
  }
}

function usageFields(state: RunState) {
  return {
    inputTokens: state.counters.inputTokens,
    outputTokens: state.counters.outputTokens,
    costUsd: state.counters.costUsd,
    stepCount: state.counters.steps,
    toolCallCount: state.counters.toolCalls,
  };
}

function citationsFor(state: RunState, text: string): Citation[] {
  const cited = new Set([...text.matchAll(/\[S(\d+)\]/g)].map((m) => Number(m[1]) - 1));
  const list = state.hints
    .map((h, i) => ({ h, i }))
    .filter(({ i }) => cited.has(i))
    .map(({ h, i }) => ({ label: `S${i + 1}`, documentId: h.documentId, title: h.source.replace(/^\[S\d+\]\s*/, ""), page: h.page, excerpt: h.content.slice(0, 280) }));
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(`${c.documentId}:${c.page}`) ? false : (seen.add(`${c.documentId}:${c.page}`), true)));
}

async function finish(
  runId: string,
  state: RunState | null,
  status: "COMPLETED" | "FAILED" | "CANCELLED",
  result: { output?: string; structured?: Record<string, unknown>; error?: string },
) {
  const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId }, include: { agent: { select: { name: true } } } });
  const citations = state && result.output ? citationsFor(state, result.output) : [];
  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status,
      output: result.output?.slice(0, 50000) ?? null,
      structuredOutput: (result.structured ?? undefined) as Prisma.InputJsonValue | undefined,
      citations: citations as unknown as Prisma.InputJsonValue,
      error: result.error?.slice(0, 2000) ?? null,
      completedAt: new Date(),
      ...(state ? { state: state as unknown as Prisma.InputJsonValue, ...usageFields(state) } : {}),
    },
  });
  if (state && result.output) {
    await addStep(runId, run.orgId, state, "OUTPUT", status === "COMPLETED" ? "Completed" : "Stopped", status === "COMPLETED" ? "SUCCEEDED" : "FAILED");
  }
  await prisma.usageRecord.create({ data: { orgId: run.orgId, kind: "AGENT_RUN", agentId: run.agentId, runId, isSimulation: run.mode === "SIMULATION" } });
  await writeAudit({
    orgId: run.orgId,
    actorType: "AGENT",
    actorAgentId: run.agentId,
    action: `agent.run.${status.toLowerCase()}`,
    entityType: "AgentRun",
    entityId: runId,
    runId,
    taskId: run.taskId ?? undefined,
    workflowRunId: run.workflowRunId ?? undefined,
    outcome: status === "FAILED" ? "FAILED" : "SUCCESS",
    metadata: { model: run.model, tokens: state ? state.counters.inputTokens + state.counters.outputTokens : 0, costUsd: state?.counters.costUsd, error: result.error },
  });

  const stillWorking = await prisma.agentRun.count({ where: { agentId: run.agentId, status: "RUNNING", id: { not: runId } } });
  if (!stillWorking) await setAgentStatus(run.agentId, status === "FAILED" ? "ERROR" : "ACTIVE", status === "FAILED" ? result.error ?? null : null);

  if (run.conversationId) {
    await prisma.message.create({
      data: {
        orgId: run.orgId,
        conversationId: run.conversationId,
        role: "AGENT",
        content: status === "COMPLETED" ? (result.output ?? "") : `I couldn't finish this: ${result.error ?? status.toLowerCase()}`,
        runId,
        metadata: {
          kind: status === "COMPLETED" ? "answer" : "error",
          citations,
          offline: state?.snapshot.model.provider === "OFFLINE",
          simulation: run.mode === "SIMULATION",
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await prisma.conversation.update({ where: { id: run.conversationId }, data: { lastMessageAt: new Date() } });
    if (status === "COMPLETED" && !run.parentRunId) {
      await recordActivity({
        orgId: run.orgId,
        category: "AGENT",
        actorType: "AGENT",
        actorAgentId: run.agentId,
        summary: `${run.agent.name} answered a question.`,
        detail: citations.length ? `${[...new Set(citations.map((c) => c.title))].join(", ")} used.` : undefined,
        entityType: "AgentRun",
        entityId: runId,
        link: `/runs/${runId}`,
        isSimulation: run.mode === "SIMULATION",
      });
    }
  }
  await hookTaskFinished(run.taskId, runId, status, result);
  if (run.workflowRunId) {
    await enqueue("workflow.advance", { workflowRunId: run.workflowRunId, agentRunId: runId }, { orgId: run.orgId });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function snapshotGrant(state: RunState, toolKey: string) {
  if (state.request.useDraft || state.request.mode === "SIMULATION") return undefined;
  return state.snapshot.tools.find((t) => t.key === toolKey)?.effect ?? null;
}

async function budgetProblem(orgId: string, agentId: string, snapshot: AgentSnapshot): Promise<string | null> {
  if (snapshot.model.provider === "OFFLINE") return null;
  const since = startOfMonth(new Date());
  const [agentSpend, orgSpend, org] = await Promise.all([
    prisma.usageRecord.aggregate({ where: { orgId, agentId, createdAt: { gte: since }, isSimulation: false }, _sum: { costUsd: true } }),
    prisma.usageRecord.aggregate({ where: { orgId, createdAt: { gte: since }, isSimulation: false }, _sum: { costUsd: true } }),
    prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { monthlyAiBudgetUsd: true } }),
  ]);
  if (snapshot.limits.monthlyBudgetUsd > 0 && (agentSpend._sum.costUsd ?? 0) >= snapshot.limits.monthlyBudgetUsd) {
    return `${snapshot.name} reached their monthly AI budget ($${snapshot.limits.monthlyBudgetUsd}).`;
  }
  if (org.monthlyAiBudgetUsd > 0 && (orgSpend._sum.costUsd ?? 0) >= org.monthlyAiBudgetUsd) {
    return `The company reached its monthly AI budget ($${org.monthlyAiBudgetUsd}).`;
  }
  return null;
}

async function persist(runId: string, state: RunState) {
  await prisma.agentRun.update({ where: { id: runId }, data: { state: state as unknown as Prisma.InputJsonValue, ...usageFields(state) } });
}

async function addStep(
  runId: string,
  orgId: string,
  state: RunState,
  type: RunStepType,
  label: string,
  status: StepStatus,
  extra: { toolKey?: string; input?: unknown; outputMeta?: unknown; approvalId?: string } = {},
): Promise<string> {
  state.seq++;
  const step = await prisma.agentRunStep.create({
    data: {
      orgId,
      runId,
      sequence: state.seq,
      type,
      label: label.slice(0, 200),
      status,
      toolKey: extra.toolKey,
      input: extra.input === undefined ? undefined : (redact(extra.input) as Prisma.InputJsonValue),
      outputMeta: extra.outputMeta === undefined ? undefined : (redact(extra.outputMeta) as Prisma.InputJsonValue),
      approvalId: extra.approvalId,
      completedAt: status === "RUNNING" ? null : new Date(),
    },
  });
  return step.id;
}

async function completeStep(
  stepId: string,
  status: StepStatus,
  outputMeta?: unknown,
  error?: string,
  latencyMs?: number,
  extra: { label?: string; tokens?: number; costUsd?: number; approvalId?: string } = {},
) {
  await prisma.agentRunStep.update({
    where: { id: stepId },
    data: {
      status,
      outputMeta: outputMeta === undefined ? undefined : (redact(outputMeta) as Prisma.InputJsonValue),
      error: error?.slice(0, 1000),
      latencyMs,
      completedAt: status === "WAITING" || status === "AWAITING_APPROVAL" ? null : new Date(),
      ...(extra.label ? { label: extra.label } : {}),
      ...(extra.tokens !== undefined ? { tokens: extra.tokens } : {}),
      ...(extra.costUsd !== undefined ? { costUsd: extra.costUsd } : {}),
      ...(extra.approvalId ? { approvalId: extra.approvalId } : {}),
    },
  });
}

async function setAgentStatus(agentId: string, status: "WORKING" | "ACTIVE" | "APPROVAL" | "WAITING" | "ERROR", message: string | null) {
  // Never override a human's pause.
  await prisma.agent.updateMany({
    where: { id: agentId, status: { not: "PAUSED" } },
    data: { status, statusMessage: message ? message.replace(/\s+/g, " ").slice(0, 140) : null },
  });
}

async function hookTaskStatus(taskId: string | null, status: "RUNNING" | "AWAITING_APPROVAL" | "WAITING" | "CANCELLED", message?: string) {
  if (!taskId) return;
  const { onTaskRunStatus } = await import("@/server/services/tasks");
  await onTaskRunStatus(taskId, status, message);
}

async function hookTaskFinished(taskId: string | null, runId: string, status: "COMPLETED" | "FAILED" | "CANCELLED", result: { output?: string; structured?: Record<string, unknown>; error?: string }) {
  if (!taskId) return;
  const { onTaskRunFinished } = await import("@/server/services/tasks");
  await onTaskRunFinished(taskId, runId, status, result);
}
