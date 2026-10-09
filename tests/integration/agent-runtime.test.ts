import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ContentPart, GenerateRequest } from "@/lib/ai/types";
import { runAgentInline } from "@/server/runtime/agent-runtime";
import { decideApproval } from "@/server/services/approvals";
import { executeTool } from "@/server/tools/executor";
import { getAgent } from "@/server/services/agents";
import { registerAllJobHandlers } from "@/server/jobs/handlers";
import { drainJobs } from "@/server/jobs/queue";
import { isAppError } from "@/lib/errors";
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

async function outbox(orgId: string) {
  return prisma.mockRecord.findMany({ where: { orgId, integrationKey: "mock_email", collection: "outbox" } });
}

describe("agent runtime — permissions and approvals", () => {
  it("pauses for approval, then executes exactly once after approval", async () => {
    const { org, user, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, { "mock_email.send_email": "REQUIRE_APPROVAL" });
    const s = useScriptedModel([
      () => [text("Sending."), call("mock_email__send_email", { to: "john@example.com", subject: "Hello", body: "Hi John" }, "c1")],
      (req) => {
        const last = req.messages[req.messages.length - 1];
        expect(last.content[0]).toMatchObject({ type: "tool_result", toolCallId: "c1" });
        return [text("Email sent (simulated integration).")];
      },
    ]);
    restore = s.restore;

    const run = await runAgentInline(org.id, agent.id, { input: "Email John", mode: "LIVE" });
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(await outbox(org.id)).toHaveLength(0);
    const approval = await prisma.approval.findFirstOrThrow({ where: { agentRunId: run.id } });
    expect(approval.status).toBe("PENDING");
    expect(approval.proposedInput).toMatchObject({ to: "john@example.com" });

    await decideApproval({ ...actor, userId: user.id }, approval.id, "APPROVED");
    await drainJobs();

    const done = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(done.status).toBe("COMPLETED");
    expect(await outbox(org.id)).toHaveLength(1);
    const audit = await prisma.auditLog.findMany({ where: { runId: run.id, action: "tool.execute", outcome: "SUCCESS" } });
    expect(audit).toHaveLength(1);
  });

  it("executes the human-edited version of an approved action", async () => {
    const { org, user, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, { "mock_email.send_email": "REQUIRE_APPROVAL" });
    restore = useScriptedModel([() => [call("mock_email__send_email", { to: "john@example.com", subject: "Helo", body: "typo" }, "c1")], () => [text("ok")]]).restore;
    const run = await runAgentInline(org.id, agent.id, { input: "Email John", mode: "LIVE" });
    const approval = await prisma.approval.findFirstOrThrow({ where: { agentRunId: run.id } });
    await decideApproval({ ...actor, userId: user.id }, approval.id, "APPROVED", { editedInput: { to: "john@example.com", subject: "Hello", body: "Fixed" } });
    await drainJobs();
    const [sent] = await outbox(org.id);
    expect((sent.data as { subject: string }).subject).toBe("Hello");
  });

  it("rejection informs the agent and nothing is sent", async () => {
    const { org, user, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, { "mock_email.send_email": "REQUIRE_APPROVAL" });
    const s = useScriptedModel([
      () => [call("mock_email__send_email", { to: "john@example.com", subject: "Hi", body: "Hi" }, "c1")],
      (req) => {
        const r = req.messages[req.messages.length - 1].content[0];
        expect(r).toMatchObject({ type: "tool_result", isError: true });
        return [text("Understood, not sending.")];
      },
    ]);
    restore = s.restore;
    const run = await runAgentInline(org.id, agent.id, { input: "Email John", mode: "LIVE" });
    const approval = await prisma.approval.findFirstOrThrow({ where: { agentRunId: run.id } });
    await decideApproval({ ...actor, userId: user.id }, approval.id, "REJECTED", { note: "Not now" });
    await drainJobs();
    expect((await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("COMPLETED");
    expect(await outbox(org.id)).toHaveLength(0);
  });

  it("company policy denies financial actions even when the agent grant allows them", async () => {
    const { org, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, { "mock_commerce.issue_refund": "ALLOW" });
    const s = useScriptedModel([
      () => [call("mock_commerce__issue_refund", { orderNumber: "1042", amount: 50 }, "c1")],
      (req) => {
        const r = req.messages[req.messages.length - 1].content[0] as { content: string; isError?: boolean };
        expect(r.isError).toBe(true);
        expect(r.content).toContain("DENIED");
        return [text("I can't issue refunds.")];
      },
    ]);
    restore = s.restore;
    const run = await runAgentInline(org.id, agent.id, { input: "Refund order 1042", mode: "LIVE" });
    expect(run.status).toBe("COMPLETED");
    expect(await prisma.mockRecord.count({ where: { orgId: org.id, collection: "refunds" } })).toBe(0);
    expect(await prisma.approval.count({ where: { orgId: org.id } })).toBe(0);
    const denied = await prisma.auditLog.count({ where: { orgId: org.id, action: "tool.execute", outcome: "DENIED" } });
    expect(denied).toBe(1);
  });

  it("never offers or executes tools the agent was not granted", async () => {
    const { org, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, { "mock_crm.search_contacts": "ALLOW", "mock_crm.delete_contact": "DENY" });
    const s = useScriptedModel([
      (req) => {
        const names = req.tools?.map((t) => t.name) ?? [];
        expect(names).toContain("mock_crm__search_contacts");
        expect(names).not.toContain("mock_crm__delete_contact");
        return [call("mock_crm__delete_contact", { id: "x" }, "c1")];
      },
      (req) => {
        const r = req.messages[req.messages.length - 1].content[0] as { content: string };
        expect(r.content).toContain("Unknown tool");
        return [text("ok")];
      },
    ]);
    restore = s.restore;
    const run = await runAgentInline(org.id, agent.id, { input: "Delete contact x", mode: "LIVE" });
    expect(run.status).toBe("COMPLETED");
  });

  it("simulation mode previews approval-gated actions without side effects", async () => {
    const { org, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, { "mock_email.send_email": "REQUIRE_APPROVAL" });
    restore = useScriptedModel([() => [call("mock_email__send_email", { to: "john@example.com", subject: "Hi", body: "Hi" }, "c1")], () => [text("Would have sent.")]]).restore;
    const run = await runAgentInline(org.id, agent.id, { input: "Email John", mode: "SIMULATION" });
    expect(run.status).toBe("COMPLETED");
    expect(await outbox(org.id)).toHaveLength(0);
    expect(await prisma.approval.count({ where: { orgId: org.id } })).toBe(0);
    const step = await prisma.agentRunStep.findFirstOrThrow({ where: { runId: run.id, type: "TOOL_CALL" } });
    expect(step.status).toBe("AWAITING_APPROVAL");
  });

  it("unpublished agents can't do live work", async () => {
    const { org, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {});
    await prisma.agent.update({ where: { id: agent.id }, data: { publishedVersion: null, lifecycle: "DRAFT" } });
    restore = useScriptedModel([() => [text("hi")]]).restore;
    const run = await runAgentInline(org.id, agent.id, { input: "hello", mode: "LIVE" });
    expect(run.status).toBe("FAILED");
    expect(run.error).toContain("hasn't been published");
  });
});

describe("agent runtime — limits, output and escalation", () => {
  it("enforces the tool-call limit", async () => {
    const { org, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, { "mock_crm.search_contacts": "ALLOW" }, { limits: { maxToolCallsPerRun: 1 } });
    restore = useScriptedModel([() => [call("mock_crm__search_contacts", { query: "a" }), call("mock_crm__search_contacts", { query: "b" })]]).restore;
    const run = await runAgentInline(org.id, agent.id, { input: "search twice", mode: "LIVE" });
    expect(run.status).toBe("FAILED");
    expect(run.escalated).toBe(true);
    expect(await prisma.approval.count({ where: { orgId: org.id, kind: "ESCALATION" } })).toBe(1);
  });

  it("repairs invalid structured output, then validates it", async () => {
    const { org, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {});
    restore = useScriptedModel([() => [text('{"lead_score": "high"}')], () => [text('{"lead_score": 85, "qualification": "qualified"}')]]).restore;
    const run = await runAgentInline(org.id, agent.id, {
      input: "Score this lead",
      mode: "LIVE",
      outputSpec: {
        name: "score",
        fields: [
          { name: "lead_score", type: "integer", description: "", required: true, min: 0, max: 100 },
          { name: "qualification", type: "string", description: "", required: true, enum: ["qualified", "nurture", "archive"] },
        ],
      },
    });
    expect(run.status).toBe("COMPLETED");
    expect(run.structuredOutput).toEqual({ lead_score: 85, qualification: "qualified" });
  });

  it("escalates after repeated invalid structured output instead of guessing", async () => {
    const { org, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {});
    restore = useScriptedModel([() => [text("nope")], () => [text("still nope")], () => [text("no json")]]).restore;
    const run = await runAgentInline(org.id, agent.id, {
      input: "Score",
      mode: "LIVE",
      outputSpec: { name: "s", fields: [{ name: "x", type: "number", description: "", required: true }] },
    });
    expect(run.status).toBe("WAITING");
    expect(run.escalated).toBe(true);
  });
});

describe("agent runtime — time limit", () => {
  /** Rewrites a paused run's saved state, the way a long wait for a human would have left it. */
  async function ageRun(runId: string, patch: Record<string, unknown>) {
    const row = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    await prisma.agentRun.update({ where: { id: runId }, data: { state: { ...(row.state as Record<string, unknown>), ...patch } as Prisma.InputJsonValue } });
  }

  /** Behaves like the real SDK: rejects as soon as the run's signal fires, otherwise answers after `ms`. */
  const answerAfter = (ms: number, content: ContentPart[]) => async (req: GenerateRequest) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      req.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("Request was aborted."));
      });
    });
    return content;
  };

  async function pausedForApproval(secondStep: (req: GenerateRequest) => Promise<ContentPart[]>) {
    const { org, user, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, { "mock_email.send_email": "REQUIRE_APPROVAL" });
    restore = useScriptedModel([() => [call("mock_email__send_email", { to: "a@b.test", subject: "Hi", body: "Hi" }, "c1")], secondStep]).restore;
    const run = await runAgentInline(org.id, agent.id, { input: "Email them", mode: "LIVE" });
    expect(run.status).toBe("AWAITING_APPROVAL");
    const approve = async () => {
      const approval = await prisma.approval.findFirstOrThrow({ where: { agentRunId: run.id } });
      await decideApproval({ ...actor, userId: user.id }, approval.id, "APPROVED");
      await drainJobs();
      return prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    };
    return { run, approve };
  }

  it("doesn't charge the time spent waiting for approval to the run", async () => {
    // One second is all a clock that counted the wait would leave this model call.
    const { run, approve } = await pausedForApproval(answerAfter(1300, [text("Email sent.")]));

    await ageRun(run.id, { startedAt: Date.now() - 45 * 60_000 }); // the human takes 45 minutes to answer
    const done = await approve();

    expect(done.error).toBeNull();
    expect(done.status).toBe("COMPLETED");
    expect(done.output).toBe("Email sent.");
  });

  it("stops a run that has used up its working time, and says so", async () => {
    const { run, approve } = await pausedForApproval(answerAfter(5000, [text("Too late.")]));

    await ageRun(run.id, { activeMs: 11 * 60_000 }); // it had already been working for 11 of its 10 minutes
    const done = await approve();

    expect(done.status).toBe("FAILED");
    expect(done.error).toBe("The run hit its time limit."); // not "The AI provider failed: Request was aborted."
    expect(done.escalated).toBe(true);
  });

  it("keeps a run that paused before working time was tracked going", async () => {
    const { run, approve } = await pausedForApproval(answerAfter(1300, [text("Email sent.")]));

    // Runs saved by the previous version have neither field.
    const row = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    const legacy: Record<string, unknown> = { ...(row.state as Record<string, unknown>), startedAt: Date.now() - 45 * 60_000 };
    delete legacy.activeMs;
    delete legacy.resumedAt;
    await prisma.agentRun.update({ where: { id: run.id }, data: { state: legacy as Prisma.InputJsonValue } });
    const done = await approve();

    expect(done.status).toBe("COMPLETED");
  });
});

describe("tool executor — idempotency and tenancy", () => {
  it("never repeats a completed side effect for the same idempotency key", async () => {
    const { org, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, { "mock_crm.create_lead": "ALLOW" });
    const params = {
      orgId: org.id,
      agentId: agent.id,
      runId: null,
      toolKey: "mock_crm.create_lead",
      input: { name: "Ann", email: "ann@x.example" },
      mode: "LIVE" as const,
      idempotencyKey: "fixed-key",
    };
    const first = await executeTool(params);
    const second = await executeTool(params);
    expect(first.status).toBe("EXECUTED");
    expect(second.status).toBe("EXECUTED");
    expect("deduplicated" in second && second.deduplicated).toBe(true);
    expect(await prisma.mockRecord.count({ where: { orgId: org.id, collection: "contacts", data: { path: ["email"], equals: "ann@x.example" } } })).toBe(1);
  });

  it("rejects an approval whose input doesn't match the executed input", async () => {
    const { org, user, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, { "mock_email.send_email": "REQUIRE_APPROVAL" });
    const approval = await prisma.approval.create({
      data: { orgId: org.id, kind: "TOOL_ACTION", status: "APPROVED", title: "x", toolKey: "mock_email.send_email", proposedInput: { to: "a@b.example", subject: "s", body: "b" }, decidedById: user.id },
    });
    const outcome = await executeTool({
      orgId: org.id,
      agentId: agent.id,
      runId: null,
      toolKey: "mock_email.send_email",
      input: { to: "attacker@evil.example", subject: "s", body: "b" },
      mode: "LIVE",
      idempotencyKey: "k2",
      approvalId: approval.id,
    });
    expect(outcome.status).toBe("REQUIRES_APPROVAL");
    expect(await outbox(org.id)).toHaveLength(0);
  });

  it("isolates tenants: another org's agent and tools are invisible", async () => {
    const a = await createFixtureOrg("Org A");
    const b = await createFixtureOrg("Org B");
    const agentB = await createFixtureAgent(b.actor, { "mock_email.send_email": "ALLOW" });
    await expect(getAgent(a.org.id, agentB.id)).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "NOT_FOUND");
    const outcome = await executeTool({
      orgId: a.org.id,
      agentId: agentB.id,
      runId: null,
      toolKey: "mock_email.send_email",
      input: { to: "x@y.example", subject: "s", body: "b" },
      mode: "LIVE",
      idempotencyKey: "k3",
    });
    expect(outcome.status).toBe("FAILED");
    expect(await outbox(b.org.id)).toHaveLength(0);
  });
});
