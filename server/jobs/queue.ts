import os from "node:os";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * Durable background job queue.
 *
 * Driver selection:
 *  - REDIS_URL set  → BullMQ on Redis
 *  - otherwise      → PostgreSQL table "Job", claimed with FOR UPDATE SKIP LOCKED
 *
 * Both drivers are at-least-once: handlers must be idempotent (tool execution
 * uses idempotency keys; run state transitions are guarded).
 */

export type JobName =
  | "agent.execute"
  | "agent.resume"
  | "workflow.advance"
  | "knowledge.index"
  | "schedules.tick"
  | "maintenance.cleanup"
  | "notifications.dispatch";

export interface EnqueueOptions {
  runAt?: Date;
  delayMs?: number;
  dedupeKey?: string;
  maxAttempts?: number;
  orgId?: string;
}

export type JobHandler = (payload: Record<string, unknown>, meta: { attempt: number; jobId: string }) => Promise<void>;

const handlers = new Map<JobName, JobHandler>();

export function registerJobHandler(name: JobName, handler: JobHandler) {
  handlers.set(name, handler);
}

function usingRedis() {
  return !!process.env.REDIS_URL;
}

// ── Enqueue ─────────────────────────────────────────────────────────────────

let bullQueue: import("bullmq").Queue | null = null;
async function getBullQueue() {
  if (!bullQueue) {
    const { Queue } = await import("bullmq");
    const { default: IORedis } = await import("ioredis");
    bullQueue = new Queue("nby", { connection: new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }) });
  }
  return bullQueue;
}

export async function enqueue(name: JobName, payload: Record<string, unknown>, opts: EnqueueOptions = {}) {
  const runAt = opts.runAt ?? new Date(Date.now() + (opts.delayMs ?? 0));
  if (usingRedis()) {
    const q = await getBullQueue();
    await q.add(name, payload, {
      jobId: opts.dedupeKey,
      delay: Math.max(0, runAt.getTime() - Date.now()),
      attempts: opts.maxAttempts ?? 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
    return;
  }
  try {
    await prisma.job.create({
      data: {
        queue: "default",
        name,
        payload: payload as Prisma.InputJsonValue,
        runAt,
        maxAttempts: opts.maxAttempts ?? 3,
        dedupeKey: opts.dedupeKey,
        orgId: opts.orgId,
      },
    });
  } catch (err) {
    // Duplicate dedupe key: the job is already queued.
    if (opts.dedupeKey && String(err).includes("Unique constraint")) return;
    throw err;
  }
  kick();
}

// ── Postgres worker ─────────────────────────────────────────────────────────

interface ClaimedJob {
  id: string;
  name: JobName;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

const workerId = `${os.hostname()}:${process.pid}`;
let wake: (() => void) | null = null;

/** Wakes the in-process worker loop immediately after an enqueue. */
function kick() {
  wake?.();
}

async function claim(): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRaw<ClaimedJob[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId},
                     "attempts" = "attempts" + 1, "updatedAt" = now()
    WHERE "id" = (
      SELECT "id" FROM "Job"
      WHERE "status" = 'PENDING' AND "runAt" <= now()
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id", "name", "payload", "attempts", "maxAttempts"`;
  return rows[0] ?? null;
}

async function recoverStale() {
  // A worker that died mid-job leaves it RUNNING; return it to the queue.
  await prisma.$executeRaw`
    UPDATE "Job" SET "status" = 'PENDING', "lockedAt" = NULL, "lockedBy" = NULL, "updatedAt" = now()
    WHERE "status" = 'RUNNING' AND "lockedAt" < now() - interval '15 minutes'`;
}

async function processJob(job: ClaimedJob) {
  const handler = handlers.get(job.name);
  if (!handler) {
    await prisma.job.update({ where: { id: job.id }, data: { status: "DEAD", lastError: `No handler for ${job.name}` } });
    return;
  }
  try {
    await handler(job.payload, { attempt: job.attempts, jobId: job.id });
    await prisma.job.update({ where: { id: job.id }, data: { status: "COMPLETED", completedAt: new Date(), lockedAt: null } });
  } catch (err) {
    const message = String((err as Error)?.stack ?? err).slice(0, 2000);
    const dead = job.attempts >= job.maxAttempts;
    console.error(`[jobs] ${job.name} ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts})`, (err as Error)?.message);
    await prisma.job.update({
      where: { id: job.id },
      data: dead
        ? { status: "DEAD", lastError: message, lockedAt: null }
        : { status: "PENDING", lastError: message, lockedAt: null, runAt: new Date(Date.now() + 2 ** job.attempts * 5000) },
    });
  }
}

let running = false;

/** Starts the job worker in this process. Safe to call more than once. */
export async function startWorker(opts: { concurrency?: number; pollMs?: number } = {}) {
  if (running) return;
  running = true;
  const concurrency = opts.concurrency ?? Number(process.env.WORKER_CONCURRENCY ?? 4);
  const pollMs = opts.pollMs ?? 1000;

  if (usingRedis()) {
    const { Worker } = await import("bullmq");
    const { default: IORedis } = await import("ioredis");
    new Worker(
      "nby",
      async (job) => {
        const handler = handlers.get(job.name as JobName);
        if (!handler) throw new Error(`No handler for ${job.name}`);
        await handler(job.data as Record<string, unknown>, { attempt: job.attemptsMade + 1, jobId: String(job.id) });
      },
      { connection: new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }), concurrency },
    );
    console.log(`[jobs] BullMQ worker started (concurrency ${concurrency})`);
    return;
  }

  console.log(`[jobs] PostgreSQL worker started (${workerId}, concurrency ${concurrency})`);
  let active = 0;
  let lastRecovery = 0;
  const loop = async () => {
    while (running) {
      try {
        if (Date.now() - lastRecovery > 60_000) {
          lastRecovery = Date.now();
          await recoverStale();
        }
        while (active < concurrency) {
          const job = await claim();
          if (!job) break;
          active++;
          void processJob(job).finally(() => {
            active--;
            kick();
          });
        }
      } catch (err) {
        console.error("[jobs] worker loop error", (err as Error)?.message);
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, pollMs);
        wake = () => {
          clearTimeout(t);
          resolve();
        };
      });
    }
  };
  void loop();
}

export function stopWorker() {
  running = false;
  kick();
}

/** Test helper: run queued jobs synchronously until the queue is empty. */
export async function drainJobs(maxJobs = 200) {
  for (let i = 0; i < maxJobs; i++) {
    const job = await claim();
    if (!job) return i;
    await processJob(job);
  }
  return maxJobs;
}
