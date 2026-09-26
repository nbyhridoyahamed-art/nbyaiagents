import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerAllJobHandlers } from "@/server/jobs/handlers";
import { drainJobs } from "@/server/jobs/queue";
import { createTask } from "@/server/services/tasks";
import { getAttention, getCompanyHealth, getDashboardSummary, getLiveWork, getWorkflowPerformance, getWorkforce } from "@/server/services/dashboard";
import { createWorkflow } from "@/server/services/workflows";
import { DEMO_TASK_INPUTS, removeDemoHistory } from "@/server/services/demo";
import { call, createFixtureAgent, createFixtureOrg, resetDb, text, useScriptedModel } from "./helpers";

let restore: (() => void) | null = null;
beforeAll(() => registerAllJobHandlers());
beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  restore?.();
  restore = null;
});

describe("dashboard data", () => {
  it("measures an empty company as zeros, not sample numbers", async () => {
    const { org } = await createFixtureOrg();
    const s = await getDashboardSummary(org.id, "UTC");
    expect(s.agents.total).toBe(0);
    expect(s.tasks).toMatchObject({ running: 0, completedToday: 0, successRateToday: null });
    expect(s.attention.total).toBe(0);
    const h = await getCompanyHealth(org.id, "UTC", 100);
    expect(h.usage).toMatchObject({ spentUsd: 0, percent: 0 });
    expect(h.knowledge.percent).toBeNull();
    expect(await getWorkflowPerformance(org.id)).toEqual([]);
  });

  it("counts today's work, attention items and live runs from real records", async () => {
    const { org, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, { "mock_email.send_email": "REQUIRE_APPROVAL" });
    // One task that completes, one that pauses for approval.
    restore = useScriptedModel([
      () => [text("Done.")],
      () => [call("mock_email__send_email", { to: "a@example.com", subject: "Hi", body: "Hello" }, "c1")],
    ]).restore;
    await createTask(actor, { title: "Summarise notes", agentId: agent.id }, { run: true });
    await drainJobs();
    await createTask(actor, { title: "Email a@example.com", agentId: agent.id }, { run: true });
    await drainJobs();
    // Yesterday's completed task must not count as "today".
    await prisma.task.create({ data: { orgId: org.id, agentId: agent.id, title: "Old", status: "COMPLETED", completedAt: new Date(Date.now() - 2 * 86_400_000) } });

    const s = await getDashboardSummary(org.id, "UTC");
    expect(s.tasks.completedToday).toBe(1);
    expect(s.tasks.successRateToday).toBe(100);
    expect(s.tasks.running).toBe(1);
    expect(s.attention).toMatchObject({ approvals: 1, questions: 0, total: 1 });

    const items = await getAttention(org.id);
    expect(items[0]).toMatchObject({ kind: "approval", who: { name: agent.name } });
    expect(items[0].href).toContain("/approvals?focus=");

    const live = await getLiveWork(org.id);
    expect(live.activeRuns).toBe(1);
    expect(live.runs[0].title).toBe("Email a@example.com");
    expect(live.runs[0].steps.some((st) => st.status === "AWAITING_APPROVAL")).toBe(true);

    const wf = await getWorkforce(org.id);
    expect(wf.agents[0]).toMatchObject({ name: agent.name, tasksCompleted: 2 });
  });

  it("reports broken integrations and usage against the budget", async () => {
    const { org, actor } = await createFixtureOrg();
    await createFixtureAgent(actor, { "mock_crm.search_contacts": "ALLOW", "mock_email.read_inbox": "ALLOW" });
    await prisma.integrationConnection.updateMany({ where: { orgId: org.id, integrationKey: "mock_email" }, data: { status: "NEEDS_REAUTH" } });
    await prisma.usageRecord.create({ data: { orgId: org.id, kind: "AI_TOKENS", costUsd: 12.5 } });
    await prisma.usageRecord.create({ data: { orgId: org.id, kind: "AI_TOKENS", costUsd: 99, createdAt: new Date(Date.now() - 62 * 86_400_000) } });

    const h = await getCompanyHealth(org.id, "UTC", 50);
    expect(h.integrations).toEqual({ connected: 1, total: 2 });
    expect(h.usage).toMatchObject({ spentUsd: 12.5, budgetUsd: 50, percent: 25 });
    const items = await getAttention(org.id);
    expect(items.some((i) => i.kind === "integration" && i.title.includes("reauthorization"))).toBe(true);
    expect((await getDashboardSummary(org.id, "UTC")).attention.integrations).toBe(1);
  });

  it("workflow performance counts live runs only", async () => {
    const { org, actor } = await createFixtureOrg();
    const wf = await createWorkflow(actor, { name: "Pipeline" });
    const version = await prisma.workflowVersion.findFirstOrThrow({ where: { workflowId: wf.id } });
    const base = { orgId: org.id, workflowId: wf.id, versionId: version.id, version: version.version, state: {} };
    await prisma.workflowRun.createMany({
      data: [
        { ...base, status: "COMPLETED", mode: "LIVE" },
        { ...base, status: "COMPLETED", mode: "LIVE" },
        { ...base, status: "FAILED", mode: "LIVE" },
        { ...base, status: "FAILED", mode: "SIMULATION" },
      ],
    });
    const [row] = await getWorkflowPerformance(org.id);
    expect(row).toMatchObject({ name: "Pipeline", runs: 3, successRate: 67 });
  });

  it("removing demo history only touches marked rows in a demo workspace", async () => {
    const { org, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {});
    await prisma.task.create({ data: { orgId: org.id, agentId: agent.id, title: "Real", status: "COMPLETED" } });
    await prisma.task.create({ data: { orgId: org.id, agentId: agent.id, title: "Demo", status: "COMPLETED", inputs: DEMO_TASK_INPUTS } });
    await expect(removeDemoHistory(org.id)).rejects.toThrow(/isn't marked as a demo/);
    await prisma.organization.update({ where: { id: org.id }, data: { isDemo: true } });
    const removed = await removeDemoHistory(org.id);
    expect(removed.tasks).toBe(1);
    expect((await prisma.task.findMany({ where: { orgId: org.id } })).map((t) => t.title)).toEqual(["Real"]);
  });
});
