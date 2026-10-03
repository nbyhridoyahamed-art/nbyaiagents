import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { registerAllJobHandlers } from "@/server/jobs/handlers";
import { drainJobs } from "@/server/jobs/queue";
import { answerQuestion } from "@/server/services/approvals";
import { fieldsFromSchema, getApprovalCard, listApprovalCards } from "@/server/services/approval-queries";
import { completeTaskManually, createTask, handBackTask, takeOverTask } from "@/server/services/tasks";
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

describe("approval inbox queries", () => {
  it("derives editable fields from a tool schema", () => {
    const fields = fieldsFromSchema(
      { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, count: { type: "integer" }, tier: { enum: ["a", "b"] }, meta: { type: "object" } }, required: ["to"] },
      { to: "x@example.com" },
    );
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.to).toMatchObject({ type: "string", required: true });
    expect(byName.body.type).toBe("text");
    expect(byName.count.type).toBe("number");
    expect(byName.tier).toMatchObject({ type: "select", options: ["a", "b"] });
    expect(byName.meta.type).toBe("json");
  });

  it("lists a pending action with its preview, fields and context, scoped to the org", async () => {
    const { org, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, { "mock_email.send_email": "REQUIRE_APPROVAL" });
    restore = useScriptedModel([() => [call("mock_email__send_email", { to: "john@example.com", subject: "Hi", body: "Hello John" }, "c1")], () => [text("done")]]).restore;
    const task = await createTask(actor, { title: "Email John", agentId: agent.id }, { run: true });
    await drainJobs();

    const cards = await listApprovalCards(org.id, { scope: "actions", view: "pending" });
    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card.agent?.name).toBe(agent.name);
    expect(card.task?.id).toBe(task.id);
    expect(card.proposedInput).toMatchObject({ to: "john@example.com" });
    expect(card.fields.map((f) => f.name)).toEqual(expect.arrayContaining(["to", "subject", "body"]));
    expect(card.riskLevel).toBe("MEDIUM");
    // Requests view doesn't include actions; other orgs see nothing.
    expect(await listApprovalCards(org.id, { scope: "requests", view: "pending" })).toHaveLength(0);
    const other = await createFixtureOrg("Other Co");
    expect(await getApprovalCard(other.org.id, card.id)).toBeNull();
  });
});

describe("human takeover", () => {
  async function pausedTask() {
    const fx = await createFixtureOrg();
    const agent = await createFixtureAgent(fx.actor, { "mock_email.send_email": "REQUIRE_APPROVAL" });
    restore = useScriptedModel([() => [call("mock_email__send_email", { to: "john@example.com", subject: "Hi", body: "Hello" }, "c1")], () => [text("done")]]).restore;
    const task = await createTask(fx.actor, { title: "Email John", agentId: agent.id }, { run: true });
    await drainJobs();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("AWAITING_APPROVAL");
    return { ...fx, agent, task };
  }

  it("stops the employee, cancels its approvals and makes the person responsible", async () => {
    const { org, user, actor, task } = await pausedTask();
    await takeOverTask({ ...actor, userId: user.id }, task.id, "I'll call John instead.");
    await drainJobs();

    const t = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(t.assigneeUserId).toBe(user.id);
    expect(t.status).toBe("WAITING");
    const runs = await prisma.agentRun.findMany({ where: { taskId: task.id } });
    expect(runs.every((r) => r.status === "CANCELLED")).toBe(true);
    expect(await prisma.approval.count({ where: { orgId: org.id, status: "PENDING" } })).toBe(0);
    expect(await prisma.mockRecord.count({ where: { orgId: org.id, collection: "outbox" } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { orgId: org.id, action: "task.takeover" } })).toBe(1);

    // Only the person who took over can finish it.
    const other = await prisma.user.create({ data: { email: "other@example.com", name: "Other" } });
    await expect(completeTaskManually({ ...actor, userId: other.id }, task.id, "x")).rejects.toSatisfy(isAppError);
    await completeTaskManually({ ...actor, userId: user.id }, task.id, "Called John; he'll reply Friday.");
    const done = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(done.status).toBe("COMPLETED");
    expect(done.result).toContain("Friday");
  });

  it("can't be taken over twice, and handing back restarts the employee with guidance", async () => {
    const { user, actor, task } = await pausedTask();
    await takeOverTask({ ...actor, userId: user.id }, task.id);
    await expect(takeOverTask({ ...actor, userId: user.id }, task.id)).rejects.toSatisfy(isAppError);

    restore?.();
    restore = useScriptedModel([
      (req) => {
        const first = JSON.stringify(req.messages[0]);
        expect(first).toContain("Use the new template");
        return [text("Done with the new template.")];
      },
    ]).restore;
    await handBackTask({ ...actor, userId: user.id }, task.id, "Use the new template");
    await drainJobs();
    const t = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(t.assigneeUserId).toBeNull();
    expect(t.status).toBe("COMPLETED");
    expect(t.result).toContain("new template");
  });

  it("an answered question resumes the paused employee", async () => {
    const { org, user, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {});
    restore = useScriptedModel([
      () => [call("vdo_ask_human", { question: "Which region?" }, "q1")],
      (req) => {
        expect(JSON.stringify(req.messages[req.messages.length - 1])).toContain("EMEA");
        return [text("Reporting on EMEA.")];
      },
    ]).restore;
    const task = await createTask(actor, { title: "Regional report", agentId: agent.id }, { run: true });
    await drainJobs();
    const [card] = await listApprovalCards(org.id, { scope: "requests", view: "pending" });
    expect(card.kind).toBe("QUESTION");
    expect(card.task?.id).toBe(task.id);
    await answerQuestion({ ...actor, userId: user.id }, card.id, "EMEA");
    await drainJobs();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("COMPLETED");
  });
});
