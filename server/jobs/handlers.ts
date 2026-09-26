import { registerJobHandler } from "@/server/jobs/queue";

let registered = false;

/** Registers every background job handler. Called by the worker and the embedded web worker. */
export function registerAllJobHandlers() {
  if (registered) return;
  registered = true;

  registerJobHandler("agent.execute", async (payload) => {
    const { executeAgentRun } = await import("@/server/runtime/agent-runtime");
    await executeAgentRun(String(payload.runId));
  });

  registerJobHandler("agent.resume", async (payload) => {
    const { resumeAgentRun } = await import("@/server/runtime/agent-runtime");
    await resumeAgentRun(String(payload.runId), String(payload.approvalId));
  });

  registerJobHandler("workflow.advance", async (payload) => {
    const { advanceWorkflowRun } = await import("@/server/workflows/engine");
    await advanceWorkflowRun(String(payload.workflowRunId), {
      approvalId: payload.approvalId ? String(payload.approvalId) : undefined,
      agentRunId: payload.agentRunId ? String(payload.agentRunId) : undefined,
    });
  });

  registerJobHandler("knowledge.index", async (payload) => {
    const { indexDocument } = await import("@/server/knowledge/indexer");
    await indexDocument(String(payload.documentId));
  });

  registerJobHandler("schedules.tick", async () => {
    const { runDueSchedules } = await import("@/server/workflows/scheduler");
    await runDueSchedules();
  });

  registerJobHandler("maintenance.cleanup", async () => {
    const { runCleanup } = await import("@/server/jobs/maintenance");
    await runCleanup();
  });
}
