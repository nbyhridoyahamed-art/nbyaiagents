import { prisma } from "@/lib/db";
import { nextRunAt } from "@/lib/workflows/schedule";
import { enqueue } from "@/server/jobs/queue";

/**
 * Scheduling runs on background jobs, never browser timers (spec §45).
 * A lightweight clock enqueues a de-duplicated "schedules.tick" each minute, so
 * any number of processes can run the clock without double-firing.
 */

let clock: NodeJS.Timeout | null = null;

export function startSchedulerClock() {
  if (clock) return;
  const tick = async () => {
    const minute = new Date().toISOString().slice(0, 16);
    try {
      await enqueue("schedules.tick", {}, { dedupeKey: `tick:${minute}`, maxAttempts: 1 });
      const day = minute.slice(0, 10);
      await enqueue("maintenance.cleanup", {}, { dedupeKey: `cleanup:${day}`, maxAttempts: 2 });
    } catch (err) {
      console.error("[scheduler] tick failed", (err as Error).message);
    }
  };
  void tick();
  clock = setInterval(tick, 30_000);
  clock.unref?.();
}

/** Fires every due schedule exactly once (compare-and-set on nextRunAt). */
export async function runDueSchedules() {
  const now = new Date();
  const due = await prisma.schedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, take: 50, orderBy: { nextRunAt: "asc" } });
  for (const s of due) {
    let next: Date;
    try {
      next = nextRunAt(s.cron, s.timezone, now);
    } catch {
      await prisma.schedule.update({ where: { id: s.id }, data: { enabled: false } });
      continue;
    }
    const claimed = await prisma.schedule.updateMany({ where: { id: s.id, nextRunAt: s.nextRunAt }, data: { nextRunAt: next, lastRunAt: now } });
    if (claimed.count === 0) continue;
    try {
      if (s.workflowId) {
        const { startWorkflowRun } = await import("@/server/workflows/engine");
        await startWorkflowRun({
          orgId: s.orgId,
          workflowId: s.workflowId,
          trigger: "SCHEDULE",
          payload: (s.payload as Record<string, unknown>) ?? {},
          mode: "LIVE",
          idempotencyKey: `schedule:${s.id}:${s.nextRunAt?.toISOString()}`,
        });
      } else if (s.agentId) {
        const { createTask } = await import("@/server/services/tasks");
        await createTask(
          { orgId: s.orgId, type: "SYSTEM" },
          { title: s.name, description: ((s.payload as { instructions?: string }) ?? {}).instructions ?? null, agentId: s.agentId },
          { run: true },
        );
      }
    } catch (err) {
      console.error("[scheduler] schedule failed", s.id, (err as Error).message);
    }
  }
}
