import { prisma } from "@/lib/db";

export type WorkflowEvent = "crm.lead.created" | "email.received";

const MAX_CHAIN = 3;

/**
 * Starts every active workflow whose trigger listens for `event`.
 * Loop protection: a run never re-triggers its own workflow, and event chains
 * are capped at depth 3.
 */
export async function emitEvent(orgId: string, event: WorkflowEvent, payload: Record<string, unknown>, opts: { sourceWorkflowRunId?: string | null } = {}) {
  let chain = 0;
  let sourceWorkflowId: string | null = null;
  if (opts.sourceWorkflowRunId) {
    const source = await prisma.workflowRun.findUnique({ where: { id: opts.sourceWorkflowRunId }, select: { workflowId: true, triggerPayload: true, mode: true } });
    if (source?.mode === "SIMULATION") return [];
    sourceWorkflowId = source?.workflowId ?? null;
    chain = Number((source?.triggerPayload as { _chain?: number } | null)?._chain ?? 0) + 1;
    if (chain >= MAX_CHAIN) return [];
  }

  const workflows = await prisma.workflow.findMany({
    where: { orgId, deletedAt: null, status: "ACTIVE", triggerType: "EVENT", publishedVersion: { not: null } },
    include: { versions: { where: { status: "PUBLISHED" }, include: { nodes: { where: { type: "trigger.event" } } } } },
  });
  const { startWorkflowRun } = await import("@/server/workflows/engine");
  const started = [];
  for (const wf of workflows) {
    if (wf.id === sourceWorkflowId) continue;
    const trigger = wf.versions[0]?.nodes[0];
    if ((trigger?.config as { event?: string } | undefined)?.event !== event) continue;
    const id = (payload.lead as { id?: string } | undefined)?.id ?? (payload.email as { id?: string } | undefined)?.id ?? JSON.stringify(payload).slice(0, 80);
    try {
      started.push(
        await startWorkflowRun({
          orgId,
          workflowId: wf.id,
          trigger: "EVENT",
          payload: { ...payload, event, _chain: chain },
          mode: "LIVE",
          idempotencyKey: `event:${event}:${wf.id}:${id}`,
        }),
      );
    } catch (err) {
      console.error("[events] failed to start workflow", wf.id, (err as Error).message);
    }
  }
  return started;
}
