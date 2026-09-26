import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type { ExecutionMode } from "@/lib/generated/prisma/enums";
import { startOfDayInTimeZone } from "@/lib/time";

/**
 * Analytics (spec §57, Phase 14). Only measured data: counts, durations, tokens and
 * estimated cost recorded while work ran. No "hours saved" or other invented figures.
 */

export const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type RangeKey = keyof typeof RANGES;

export interface AnalyticsFilter {
  from: Date;
  to: Date;
  days: number;
  timeZone: string;
  /** Include test runs (simulations). Off by default: they aren't real work. */
  includeSimulations: boolean;
}

const DAY = 86_400_000;

export function buildFilter(range: RangeKey, timeZone: string, includeSimulations: boolean, now = new Date()): AnalyticsFilter {
  const days = RANGES[range];
  const today = startOfDayInTimeZone(timeZone, now);
  const from = startOfDayInTimeZone(timeZone, new Date(today.getTime() - (days - 1) * DAY + 12 * 3_600_000));
  return { from, to: now, days, timeZone, includeSimulations };
}

/** The same-length period immediately before, for honest period-over-period deltas. */
export function previousFilter(f: AnalyticsFilter): AnalyticsFilter {
  const span = f.to.getTime() - f.from.getTime();
  return { ...f, from: new Date(f.from.getTime() - span), to: f.from };
}

const modes = (f: AnalyticsFilter): ExecutionMode[] => (f.includeSimulations ? ["LIVE", "SIMULATION"] : ["LIVE"]);
const ms = (a: Date | null, b: Date | null) => (a && b ? b.getTime() - a.getTime() : null);
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const rate = (ok: number, bad: number) => (ok + bad > 0 ? Math.round((ok / (ok + bad)) * 1000) / 10 : null);

export interface Overview {
  executions: { agentRuns: number; workflowRuns: number; total: number };
  successRate: number | null;
  succeeded: number;
  failed: number;
  tasks: { completed: number; failed: number; avgDurationMs: number | null };
  escalations: number;
  tokens: { input: number; output: number; total: number };
  costUsd: number;
  errors: number;
}

export async function getOverview(orgId: string, f: AnalyticsFilter): Promise<Overview> {
  const created = { gte: f.from, lt: f.to };
  const [agentRuns, workflowRuns, tasks, usage, toolErrors] = await Promise.all([
    prisma.agentRun.groupBy({ by: ["status"], where: { orgId, createdAt: created, mode: { in: modes(f) } }, _count: true }),
    prisma.workflowRun.groupBy({ by: ["status"], where: { orgId, createdAt: created, mode: { in: modes(f) } }, _count: true }),
    prisma.task.findMany({
      where: { orgId, completedAt: created, status: { in: ["COMPLETED", "FAILED"] }, mode: { in: modes(f) } },
      select: { status: true, startedAt: true, completedAt: true },
    }),
    prisma.usageRecord.aggregate({
      where: { orgId, kind: "AI_TOKENS", createdAt: created, ...(f.includeSimulations ? {} : { isSimulation: false }) },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    }),
    prisma.auditLog.count({ where: { orgId, action: "tool.execute", outcome: "FAILED", createdAt: created } }),
  ]);
  const escalations = await prisma.agentRun.count({ where: { orgId, createdAt: created, mode: { in: modes(f) }, escalated: true } });
  const count = (g: { status: string; _count: number }[], s: string[]) => g.filter((x) => s.includes(x.status)).reduce((a, x) => a + x._count, 0);
  const ar = agentRuns.reduce((s, g) => s + g._count, 0);
  const wr = workflowRuns.reduce((s, g) => s + g._count, 0);
  const succeeded = count(agentRuns, ["COMPLETED"]) + count(workflowRuns, ["COMPLETED"]);
  const failed = count(agentRuns, ["FAILED"]) + count(workflowRuns, ["FAILED"]);
  const done = tasks.filter((t) => t.status === "COMPLETED");
  const input = usage._sum.inputTokens ?? 0;
  const output = usage._sum.outputTokens ?? 0;
  return {
    executions: { agentRuns: ar, workflowRuns: wr, total: ar + wr },
    successRate: rate(succeeded, failed),
    succeeded,
    failed,
    tasks: {
      completed: done.length,
      failed: tasks.length - done.length,
      avgDurationMs: avg(done.map((t) => ms(t.startedAt, t.completedAt)).filter((x): x is number => x !== null && x >= 0)),
    },
    escalations,
    tokens: { input, output, total: input + output },
    costUsd: Math.round((usage._sum.costUsd ?? 0) * 10000) / 10000,
    errors: failed + toolErrors,
  };
}

export interface DailyPoint {
  day: string;
  succeeded: number;
  failed: number;
  other: number;
  costUsd: number;
  tokens: number;
}

/** Day keys (YYYY-MM-DD) in the company's time zone, oldest first. */
export function dayKeys(f: AnalyticsFilter): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: f.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const keys: string[] = [];
  for (let i = f.days - 1; i >= 0; i--) {
    const key = fmt.format(new Date(f.to.getTime() - i * DAY));
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

function safeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export async function getDailySeries(orgId: string, f: AnalyticsFilter): Promise<DailyPoint[]> {
  const tz = safeZone(f.timeZone);
  const modeList = modes(f);
  // Timestamps are stored as UTC wall-clock; convert to the company's local day.
  const day = (col: string) => Prisma.sql`to_char(date_trunc('day', (${Prisma.raw(col)} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}), 'YYYY-MM-DD')`;
  const modeSql = Prisma.join(modeList.map((m) => Prisma.sql`${m}::"ExecutionMode"`));
  const [runs, usage] = await Promise.all([
    prisma.$queryRaw<{ day: string; status: string; n: number }[]>`
      SELECT d.day, d.status, sum(d.n)::int AS n FROM (
        SELECT ${day('"createdAt"')} AS day, status::text AS status, count(*) AS n
          FROM "AgentRun" WHERE "orgId" = ${orgId} AND "createdAt" >= ${f.from} AND "createdAt" < ${f.to} AND mode IN (${modeSql})
          GROUP BY 1, 2
        UNION ALL
        SELECT ${day('"createdAt"')} AS day, status::text AS status, count(*) AS n
          FROM "WorkflowRun" WHERE "orgId" = ${orgId} AND "createdAt" >= ${f.from} AND "createdAt" < ${f.to} AND mode IN (${modeSql})
          GROUP BY 1, 2
      ) d GROUP BY 1, 2`,
    prisma.$queryRaw<{ day: string; cost: number; tokens: number }[]>`
      SELECT ${day('"createdAt"')} AS day, coalesce(sum("costUsd"), 0)::float8 AS cost, coalesce(sum("inputTokens" + "outputTokens"), 0)::int AS tokens
        FROM "UsageRecord"
       WHERE "orgId" = ${orgId} AND kind = 'AI_TOKENS' AND "createdAt" >= ${f.from} AND "createdAt" < ${f.to}
         ${f.includeSimulations ? Prisma.empty : Prisma.sql`AND "isSimulation" = false`}
       GROUP BY 1`,
  ]);
  return dayKeys(f).map((d) => {
    const rows = runs.filter((r) => r.day === d);
    const n = (s: string[]) => rows.filter((r) => s.includes(r.status)).reduce((a, r) => a + r.n, 0);
    const u = usage.find((x) => x.day === d);
    return {
      day: d,
      succeeded: n(["COMPLETED"]),
      failed: n(["FAILED"]),
      other: rows.reduce((a, r) => a + r.n, 0) - n(["COMPLETED", "FAILED"]),
      costUsd: Math.round((u?.cost ?? 0) * 10000) / 10000,
      tokens: u?.tokens ?? 0,
    };
  });
}

export interface AgentPerformanceRow {
  id: string;
  name: string;
  jobTitle: string;
  color: string;
  tasksCompleted: number;
  tasksFailed: number;
  successRate: number | null;
  avgTaskMs: number | null;
  runs: number;
  runErrors: number;
  escalations: number;
  tokens: number;
  costUsd: number;
}

export async function getAgentPerformance(orgId: string, f: AnalyticsFilter): Promise<AgentPerformanceRow[]> {
  const created = { gte: f.from, lt: f.to };
  const [agents, tasks, runs, escalated, usage] = await Promise.all([
    prisma.agent.findMany({ where: { orgId, deletedAt: null }, select: { id: true, name: true, jobTitle: true, avatarColor: true } }),
    prisma.task.findMany({
      where: { orgId, agentId: { not: null }, completedAt: created, status: { in: ["COMPLETED", "FAILED"] }, mode: { in: modes(f) } },
      select: { agentId: true, status: true, startedAt: true, completedAt: true },
    }),
    prisma.agentRun.groupBy({ by: ["agentId", "status"], where: { orgId, createdAt: created, mode: { in: modes(f) } }, _count: true }),
    prisma.agentRun.groupBy({ by: ["agentId"], where: { orgId, createdAt: created, mode: { in: modes(f) }, escalated: true }, _count: true }),
    prisma.usageRecord.groupBy({
      by: ["agentId"],
      where: { orgId, kind: "AI_TOKENS", agentId: { not: null }, createdAt: created, ...(f.includeSimulations ? {} : { isSimulation: false }) },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    }),
  ]);
  return agents
    .map((a) => {
      const mine = tasks.filter((t) => t.agentId === a.id);
      const done = mine.filter((t) => t.status === "COMPLETED");
      const r = runs.filter((x) => x.agentId === a.id);
      const u = usage.find((x) => x.agentId === a.id)?._sum;
      return {
        id: a.id,
        name: a.name,
        jobTitle: a.jobTitle,
        color: a.avatarColor,
        tasksCompleted: done.length,
        tasksFailed: mine.length - done.length,
        successRate: rate(done.length, mine.length - done.length),
        avgTaskMs: avg(done.map((t) => ms(t.startedAt, t.completedAt)).filter((x): x is number => x !== null && x >= 0)),
        runs: r.reduce((s, x) => s + x._count, 0),
        runErrors: r.filter((x) => x.status === "FAILED").reduce((s, x) => s + x._count, 0),
        escalations: escalated.find((x) => x.agentId === a.id)?._count ?? 0,
        tokens: (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0),
        costUsd: Math.round((u?.costUsd ?? 0) * 10000) / 10000,
      };
    })
    .sort((a, b) => b.tasksCompleted + b.runs - (a.tasksCompleted + a.runs) || a.name.localeCompare(b.name));
}

export interface WorkflowAnalyticsRow {
  id: string;
  name: string;
  status: string;
  runs: number;
  completed: number;
  failed: number;
  completionRate: number | null;
  avgDurationMs: number | null;
  costUsd: number;
  lastRunAt: string | null;
}

export async function getWorkflowAnalytics(orgId: string, f: AnalyticsFilter): Promise<WorkflowAnalyticsRow[]> {
  const created = { gte: f.from, lt: f.to };
  const [workflows, runs] = await Promise.all([
    prisma.workflow.findMany({ where: { orgId, deletedAt: null }, select: { id: true, name: true, status: true } }),
    prisma.workflowRun.findMany({
      where: { orgId, createdAt: created, mode: { in: modes(f) } },
      select: { workflowId: true, status: true, startedAt: true, completedAt: true, costUsd: true, createdAt: true },
    }),
  ]);
  return workflows
    .map((w) => {
      const mine = runs.filter((r) => r.workflowId === w.id);
      const completed = mine.filter((r) => r.status === "COMPLETED");
      const failed = mine.filter((r) => r.status === "FAILED").length;
      const last = mine.reduce<Date | null>((m, r) => (!m || r.createdAt > m ? r.createdAt : m), null);
      return {
        id: w.id,
        name: w.name,
        status: w.status,
        runs: mine.length,
        completed: completed.length,
        failed,
        completionRate: rate(completed.length, failed),
        avgDurationMs: avg(completed.map((r) => ms(r.startedAt, r.completedAt)).filter((x): x is number => x !== null && x >= 0)),
        costUsd: Math.round(mine.reduce((s, r) => s + r.costUsd, 0) * 10000) / 10000,
        lastRunAt: last?.toISOString() ?? null,
      };
    })
    .filter((w) => w.runs > 0 || w.status === "ACTIVE")
    .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name));
}

export interface ModelUsageRow {
  provider: string | null;
  model: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function getModelUsage(orgId: string, f: AnalyticsFilter): Promise<{ rows: ModelUsageRow[]; embeddings: { tokens: number; chunks: number } }> {
  const created = { gte: f.from, lt: f.to };
  const sim = f.includeSimulations ? {} : { isSimulation: false };
  const [rows, emb] = await Promise.all([
    prisma.usageRecord.groupBy({
      by: ["provider", "model"],
      where: { orgId, kind: "AI_TOKENS", createdAt: created, ...sim },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    }),
    prisma.usageRecord.aggregate({ where: { orgId, kind: "EMBEDDING_TOKENS", createdAt: created }, _sum: { inputTokens: true, quantity: true } }),
  ]);
  return {
    rows: rows
      .map((r) => ({
        provider: r.provider,
        model: r.model,
        calls: r._count,
        inputTokens: r._sum.inputTokens ?? 0,
        outputTokens: r._sum.outputTokens ?? 0,
        costUsd: Math.round((r._sum.costUsd ?? 0) * 10000) / 10000,
      }))
      .sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls),
    embeddings: { tokens: emb._sum.inputTokens ?? 0, chunks: emb._sum.quantity ?? 0 },
  };
}

export interface ErrorItem {
  id: string;
  at: string;
  source: "employee" | "workflow" | "tool";
  who: string;
  message: string;
  href: string | null;
  isSimulation: boolean;
}

function toolErrorMessage(metadata: unknown): string {
  const m = (metadata ?? {}) as { error?: unknown; reason?: unknown };
  if (typeof m.error === "string" && m.error) return m.error;
  if (m.reason === "outcome_unknown") return "The tool didn't confirm whether it succeeded, so it wasn't retried automatically.";
  return "The tool call failed.";
}

export async function getRecentErrors(orgId: string, f: AnalyticsFilter, limit = 12): Promise<ErrorItem[]> {
  const created = { gte: f.from, lt: f.to };
  const [agentRuns, workflowRuns, tools] = await Promise.all([
    prisma.agentRun.findMany({
      where: { orgId, createdAt: created, status: "FAILED", mode: { in: modes(f) } },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { agent: { select: { name: true } } },
    }),
    prisma.workflowRun.findMany({
      where: { orgId, createdAt: created, status: "FAILED", mode: { in: modes(f) } },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { workflow: { select: { name: true } } },
    }),
    prisma.auditLog.findMany({ where: { orgId, action: "tool.execute", outcome: "FAILED", createdAt: created }, orderBy: { createdAt: "desc" }, take: limit }),
  ]);
  const items: ErrorItem[] = [
    ...agentRuns.map((r) => ({
      id: r.id,
      at: (r.completedAt ?? r.createdAt).toISOString(),
      source: "employee" as const,
      who: r.agent.name,
      message: r.error ?? "The run failed.",
      href: `/runs/${r.id}`,
      isSimulation: r.mode === "SIMULATION",
    })),
    ...workflowRuns.map((r) => ({
      id: r.id,
      at: (r.completedAt ?? r.createdAt).toISOString(),
      source: "workflow" as const,
      who: r.workflow.name,
      message: r.error ?? "The run failed.",
      href: `/workflows/runs/${r.id}`,
      isSimulation: r.mode === "SIMULATION",
    })),
    ...tools.map((t) => ({
      id: t.id,
      at: t.createdAt.toISOString(),
      source: "tool" as const,
      who: t.toolKey ?? "Tool",
      message: toolErrorMessage(t.metadata),
      href: t.runId ? `/runs/${t.runId}` : t.workflowRunId ? `/workflows/runs/${t.workflowRunId}` : null,
      isSimulation: false,
    })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
