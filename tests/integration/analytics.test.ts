import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildFilter, dayKeys, getAgentPerformance, getDailySeries, getModelUsage, getOverview, getRecentErrors, getWorkflowAnalytics, previousFilter } from "@/server/services/analytics";
import { createWorkflow } from "@/server/services/workflows";
import { createFixtureAgent, createFixtureOrg, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
});

const HOUR = 3_600_000;

describe("analytics", () => {
  it("excludes test runs unless asked, and measures success, tokens and cost", async () => {
    const { org, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {});
    const now = new Date();
    await prisma.agentRun.createMany({
      data: [
        { orgId: org.id, agentId: agent.id, status: "COMPLETED", mode: "LIVE" },
        { orgId: org.id, agentId: agent.id, status: "FAILED", mode: "LIVE", error: "Boom" },
        { orgId: org.id, agentId: agent.id, status: "COMPLETED", mode: "SIMULATION" },
      ],
    });
    await prisma.task.create({ data: { orgId: org.id, agentId: agent.id, title: "t", status: "COMPLETED", startedAt: new Date(now.getTime() - 60_000), completedAt: now } });
    await prisma.usageRecord.createMany({
      data: [
        { orgId: org.id, kind: "AI_TOKENS", agentId: agent.id, provider: "ANTHROPIC", model: "claude-opus-5", inputTokens: 1000, outputTokens: 200, costUsd: 0.5 },
        { orgId: org.id, kind: "AI_TOKENS", agentId: agent.id, provider: "ANTHROPIC", model: "claude-opus-5", inputTokens: 500, outputTokens: 100, costUsd: 0.25, isSimulation: true },
      ],
    });

    const live = buildFilter("7d", "UTC", false);
    const o = await getOverview(org.id, live);
    expect(o.executions.agentRuns).toBe(2);
    expect(o.successRate).toBe(50);
    expect(o.tokens.total).toBe(1200);
    expect(o.costUsd).toBe(0.5);
    expect(o.tasks).toMatchObject({ completed: 1, avgDurationMs: 60_000 });

    const all = await getOverview(org.id, buildFilter("7d", "UTC", true));
    expect(all.executions.agentRuns).toBe(3);
    expect(all.costUsd).toBe(0.75);

    const [row] = await getAgentPerformance(org.id, live);
    expect(row).toMatchObject({ name: agent.name, runs: 2, runErrors: 1, tasksCompleted: 1, tokens: 1200 });
    const models = await getModelUsage(org.id, live);
    expect(models.rows).toEqual([expect.objectContaining({ model: "claude-opus-5", calls: 1, inputTokens: 1000 })]);
    const errors = await getRecentErrors(org.id, live);
    expect(errors[0]).toMatchObject({ source: "employee", message: "Boom" });
  });

  it("buckets days in the company's time zone and fills empty days", async () => {
    const { org, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {});
    const f = buildFilter("7d", "Asia/Dhaka", false);
    expect(dayKeys(f)).toHaveLength(7);
    // 20:00 UTC yesterday is already "today" in Dhaka (UTC+6) when it's 02:00+ there.
    const at = new Date(f.to.getTime() - 2 * HOUR);
    await prisma.agentRun.create({ data: { orgId: org.id, agentId: agent.id, status: "COMPLETED", mode: "LIVE", createdAt: at } });
    const series = await getDailySeries(org.id, f);
    expect(series).toHaveLength(7);
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
    expect(series.find((p) => p.day === key)?.succeeded).toBe(1);
    expect(series.reduce((s, p) => s + p.succeeded, 0)).toBe(1);
  });

  it("compares with the previous period and reports workflow completion", async () => {
    const { org, actor } = await createFixtureOrg();
    const wf = await createWorkflow(actor, { name: "Pipeline" });
    const v = await prisma.workflowVersion.findFirstOrThrow({ where: { workflowId: wf.id } });
    const f = buildFilter("7d", "UTC", false);
    const base = { orgId: org.id, workflowId: wf.id, versionId: v.id, version: 1, state: {}, mode: "LIVE" as const };
    const now = Date.now();
    await prisma.workflowRun.createMany({
      data: [
        { ...base, status: "COMPLETED", startedAt: new Date(now - 10_000), completedAt: new Date(now), createdAt: new Date(now - 10_000) },
        { ...base, status: "FAILED", createdAt: new Date(now - HOUR) },
        { ...base, status: "COMPLETED", createdAt: new Date(f.from.getTime() - 2 * 86_400_000) },
      ],
    });
    const [row] = await getWorkflowAnalytics(org.id, f);
    expect(row).toMatchObject({ runs: 2, completed: 1, failed: 1, completionRate: 50, avgDurationMs: 10_000 });
    const prev = await getOverview(org.id, previousFilter(f));
    expect(prev.executions.workflowRuns).toBe(1);
  });
});
