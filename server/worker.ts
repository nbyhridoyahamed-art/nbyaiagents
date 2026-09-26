/**
 * Background worker process (production): `npm run worker`.
 * Executes agent runs, workflow steps, knowledge indexing and schedules.
 * Run as many replicas as needed — jobs are claimed with SKIP LOCKED (or BullMQ).
 */
import "dotenv/config";
import { registerAllJobHandlers } from "@/server/jobs/handlers";
import { startWorker, stopWorker } from "@/server/jobs/queue";
import { startSchedulerClock } from "@/server/workflows/scheduler";

async function main() {
  registerAllJobHandlers();
  await startWorker();
  startSchedulerClock();
  console.log("[worker] ready");
  const shutdown = () => {
    console.log("[worker] shutting down…");
    stopWorker();
    setTimeout(() => process.exit(0), 2000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] failed to start", err);
  process.exit(1);
});
