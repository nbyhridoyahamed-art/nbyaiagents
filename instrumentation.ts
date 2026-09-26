/**
 * Starts an embedded background worker inside the web server so a single
 * `npm run dev` processes jobs. Disable with EMBEDDED_WORKER=false when running
 * dedicated `npm run worker` processes (recommended in production).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.EMBEDDED_WORKER === "false") return;
  const { registerAllJobHandlers } = await import("@/server/jobs/handlers");
  const { startWorker } = await import("@/server/jobs/queue");
  const { startSchedulerClock } = await import("@/server/workflows/scheduler");
  registerAllJobHandlers();
  await startWorker({ concurrency: Number(process.env.WORKER_CONCURRENCY ?? 3) });
  startSchedulerClock();
}
