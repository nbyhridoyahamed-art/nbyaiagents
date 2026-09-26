import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { setProviderFactory } from "@/lib/ai/router";
import { registerAllJobHandlers } from "@/server/jobs/handlers";
import { drainJobs } from "@/server/jobs/queue";
import { createWorkflow, publishWorkflow, simulateDraft, runWorkflowNow, validateDraft } from "@/server/services/workflows";
import { decideApproval } from "@/server/services/approvals";
import { startWorkflowRun } from "@/server/workflows/engine";
import type { WorkflowGraph } from "@/lib/workflows/types";
import { createFixtureAgent, createFixtureOrg, resetDb } from "./helpers";

beforeAll(() => registerAllJobHandlers());
beforeEach(async () => {
  await resetDb();
  setProviderFactory(null);
});
afterEach(() => setProviderFactory(null));

async function settle() {
  for (let i = 0; i < 10; i++) if ((await drainJobs()) === 0) break;
}

function leadOutreachGraph(agentId: string): WorkflowGraph {
  return {
    nodes: [
      { key: "trigger", type: "trigger.webhook", label: "New lead", config: { requireSignature: true }, position: { x: 0, y: 0 } },
      { key: "research", type: "tool.call", label: "Research company", config: { toolKey: "mock_search.company_profile", input: { company: "{{lead.company}}" }, agentId }, position: { x: 0, y: 0 } },
      {
        key: "score",
        type: "ai.extract",
        label: "Score lead",
        config: {
          input: "{{lead.name}} from {{lead.company}} wants enterprise pricing for 50 seats. Budget approved.",
          outputSpec: { name: "score", fields: [{ name: "lead_score", type: "integer", min: 0, max: 100, required: true, description: "" }, { name: "qualification", type: "string", enum: ["qualified", "nurture", "archive"], required: true, description: "" }] },
          outputVar: "scored",
        },
        position: { x: 0, y: 0 },
      },
      { key: "branch", type: "logic.if", label: "Qualified?", config: { condition: { mode: "all", conditions: [{ left: "{{scored.lead_score}}", op: "gte", right: "50" }] } }, position: { x: 0, y: 0 } },
      { key: "draft", type: "ai.generate", label: "Draft email", config: { prompt: "Write a short first email to {{lead.name}}.", outputVar: "draft" }, position: { x: 0, y: 0 } },
      { key: "send", type: "tool.call", label: "Send email", config: { toolKey: "mock_email.send_email", input: { to: "{{lead.email}}", subject: "Hello from Acme", body: "{{draft.text}}" }, agentId }, position: { x: 0, y: 0 } },
      { key: "crm", type: "tool.call", label: "Update CRM", config: { toolKey: "mock_crm.create_lead", input: { name: "{{lead.name}}", email: "{{lead.email}}", company: "{{lead.company}}", source: "website" }, agentId }, position: { x: 0, y: 0 } },
      { key: "archive", type: "data.store", label: "Archive", config: { key: "archived", value: "{{lead.email}}" }, position: { x: 0, y: 0 } },
    ],
    edges: [
      { key: "e1", source: "trigger", target: "research" },
      { key: "e2", source: "research", target: "score" },
      { key: "e3", source: "score", target: "branch" },
      { key: "e4", source: "branch", target: "draft", sourceHandle: "true" },
      { key: "e5", source: "branch", target: "archive", sourceHandle: "false" },
      { key: "e6", source: "draft", target: "send" },
      { key: "e7", source: "send", target: "crm" },
    ],
  };
}

const LEAD = { lead: { name: "Dana Ortiz", email: "dana@initrode.example", company: "Initrode" } };

describe("workflow engine — acceptance scenario", () => {
  it("simulates, publishes, runs live, pauses for approval, sends once, updates CRM", async () => {
    const { org, user, actor } = await createFixtureOrg();
    const sarah = await createFixtureAgent(actor, {
      "mock_search.company_profile": "ALLOW",
      "mock_email.send_email": "REQUIRE_APPROVAL",
      "mock_crm.create_lead": "ALLOW",
    });
    const wf = await createWorkflow(actor, { name: "Lead Outreach", graph: leadOutreachGraph(sarah.id) });

    // Publishing without a simulation is refused (Draft → Test → Publish).
    await expect(publishWorkflow(actor, wf.id)).rejects.toThrow(/simulation/);

    // Simulation: nothing real happens.
    const before = await prisma.mockRecord.count({ where: { orgId: org.id, collection: { in: ["outbox", "contacts"] } } });
    const sim = await simulateDraft(actor, wf.id, LEAD);
    await settle();
    const simRun = await prisma.workflowRun.findUniqueOrThrow({ where: { id: sim.id } });
    expect(simRun.status).toBe("COMPLETED");
    expect(await prisma.mockRecord.count({ where: { orgId: org.id, collection: { in: ["outbox", "contacts"] } } })).toBe(before);
    expect(await prisma.approval.count({ where: { orgId: org.id, kind: "TOOL_ACTION" } })).toBe(0);

    await publishWorkflow(actor, wf.id);
    const webhook = await prisma.webhook.findFirstOrThrow({ where: { workflowId: wf.id } });
    expect(webhook.enabled).toBe(true);

    // Live run: pauses at the approval-gated send.
    const live = await startWorkflowRun({ orgId: org.id, workflowId: wf.id, trigger: "WEBHOOK", payload: LEAD, mode: "LIVE", idempotencyKey: "lead-1" });
    await settle();
    let run = await prisma.workflowRun.findUniqueOrThrow({ where: { id: live.id } });
    expect(run.status).toBe("AWAITING_APPROVAL");
    const approval = await prisma.approval.findFirstOrThrow({ where: { workflowRunId: live.id, kind: "TOOL_ACTION" } });
    expect(approval.toolKey).toBe("mock_email.send_email");
    expect((approval.proposedInput as { to: string }).to).toBe("dana@initrode.example");

    // Duplicate trigger (webhook retry) is idempotent.
    const dup = await startWorkflowRun({ orgId: org.id, workflowId: wf.id, trigger: "WEBHOOK", payload: LEAD, mode: "LIVE", idempotencyKey: "lead-1" });
    expect(dup.id).toBe(live.id);

    await decideApproval({ ...actor, userId: user.id }, approval.id, "APPROVED");
    await settle();
    run = await prisma.workflowRun.findUniqueOrThrow({ where: { id: live.id } });
    expect(run.status).toBe("COMPLETED");
    expect(await prisma.mockRecord.count({ where: { orgId: org.id, collection: "outbox" } })).toBe(1);
    expect(await prisma.mockRecord.count({ where: { orgId: org.id, collection: "contacts", data: { path: ["email"], equals: "dana@initrode.example" } } })).toBe(1);

    const steps = await prisma.workflowRunStep.findMany({ where: { runId: live.id }, orderBy: { sequence: "asc" } });
    expect(steps.map((s) => s.nodeKey)).toEqual(expect.arrayContaining(["research", "score", "branch", "draft", "send", "crm"]));
    const state = run.state as { nodes: Record<string, { status: string }> };
    expect(state.nodes.archive.status).toBe("SKIPPED"); // dead-path elimination
    expect(await prisma.activityLog.count({ where: { orgId: org.id, category: "WORKFLOW" } })).toBeGreaterThan(0);
  });

  it("a rejected action stops the path gracefully without sending", async () => {
    const { org, user, actor } = await createFixtureOrg();
    const sarah = await createFixtureAgent(actor, { "mock_search.company_profile": "ALLOW", "mock_email.send_email": "REQUIRE_APPROVAL", "mock_crm.create_lead": "ALLOW" });
    const wf = await createWorkflow(actor, { name: "Lead Outreach", graph: leadOutreachGraph(sarah.id) });
    await simulateDraft(actor, wf.id, LEAD);
    await settle();
    await publishWorkflow(actor, wf.id);
    const live = await runWorkflowNow(actor, wf.id, LEAD);
    await settle();
    const approval = await prisma.approval.findFirstOrThrow({ where: { workflowRunId: live.id } });
    await decideApproval({ ...actor, userId: user.id }, approval.id, "REJECTED", { note: "Not a fit" });
    await settle();
    const run = await prisma.workflowRun.findUniqueOrThrow({ where: { id: live.id } });
    expect(run.status).toBe("COMPLETED");
    expect(await prisma.mockRecord.count({ where: { orgId: org.id, collection: "outbox" } })).toBe(0);
    expect((run.state as { nodes: Record<string, { status: string }> }).nodes.crm.status).toBe("SKIPPED");
  });
});

describe("workflow engine — logic and validation", () => {
  it("human approval nodes branch on the decision", async () => {
    const { user, actor } = await createFixtureOrg();
    const graph: WorkflowGraph = {
      nodes: [
        { key: "t", type: "trigger.manual", label: "Start", config: {}, position: { x: 0, y: 0 } },
        { key: "ok", type: "human.approval", label: "Approve campaign", config: { title: "Approve {{campaign}}" }, position: { x: 0, y: 0 } },
        { key: "yes", type: "data.store", label: "Yes", config: { key: "result", value: "approved" }, position: { x: 0, y: 0 } },
        { key: "no", type: "data.store", label: "No", config: { key: "result", value: "rejected" }, position: { x: 0, y: 0 } },
      ],
      edges: [
        { key: "a", source: "t", target: "ok" },
        { key: "b", source: "ok", target: "yes", sourceHandle: "approved" },
        { key: "c", source: "ok", target: "no", sourceHandle: "rejected" },
      ],
    };
    const wf = await createWorkflow(actor, { name: "Approval flow", graph });
    await simulateDraft(actor, wf.id, { campaign: "Spring" });
    await settle();
    await publishWorkflow(actor, wf.id);
    const run = await runWorkflowNow(actor, wf.id, { campaign: "Spring" });
    await settle();
    const approval = await prisma.approval.findFirstOrThrow({ where: { workflowRunId: run.id } });
    expect(approval.title).toBe("Approve Spring");
    await decideApproval({ ...actor, userId: user.id }, approval.id, "REJECTED");
    await settle();
    const done = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(done.status).toBe("COMPLETED");
    expect(done.output).toEqual({ result: "rejected" });
  });

  it("loops over items and merges parallel branches", async () => {
    const { actor } = await createFixtureOrg();
    await createFixtureAgent(actor, { "mock_crm.create_lead": "ALLOW" });
    const graph: WorkflowGraph = {
      nodes: [
        { key: "t", type: "trigger.manual", label: "Start", config: {}, position: { x: 0, y: 0 } },
        { key: "p", type: "logic.parallel", label: "Fan out", config: {}, position: { x: 0, y: 0 } },
        { key: "a", type: "data.set", label: "A", config: { assignments: [{ name: "a", value: "1" }] }, position: { x: 0, y: 0 } },
        { key: "b", type: "data.set", label: "B", config: { assignments: [{ name: "b", value: "2" }] }, position: { x: 0, y: 0 } },
        { key: "m", type: "logic.merge", label: "Merge", config: {}, position: { x: 0, y: 0 } },
        { key: "loop", type: "logic.loop", label: "Each lead", config: { items: "{{leads}}", maxItems: 10, itemVar: "lead", outputVar: "looped" }, position: { x: 0, y: 0 } },
        { key: "x", type: "data.transform", label: "Shape", config: { template: { email: "{{lead.email}}", upper: "{{lead.name}}!" } }, position: { x: 0, y: 0 } },
        { key: "end", type: "flow.end", label: "End", config: { output: "{{looped.count}}" }, position: { x: 0, y: 0 } },
      ],
      edges: [
        { key: "1", source: "t", target: "p" },
        { key: "2", source: "p", target: "a" },
        { key: "3", source: "p", target: "b" },
        { key: "4", source: "a", target: "m" },
        { key: "5", source: "b", target: "m" },
        { key: "6", source: "m", target: "loop" },
        { key: "7", source: "loop", target: "x", sourceHandle: "each" },
        { key: "8", source: "loop", target: "end", sourceHandle: "done" },
      ],
    };
    const wf = await createWorkflow(actor, { name: "Loop", graph });
    const run = await simulateDraft(actor, wf.id, { leads: [{ name: "A", email: "a@x.example" }, { name: "B", email: "b@x.example" }] });
    await settle();
    const done = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(done.status).toBe("COMPLETED");
    expect(done.output).toBe(2);
    const state = done.state as { vars: Record<string, unknown>; nodes: Record<string, { output: unknown }> };
    expect(state.vars.a).toBe("1");
    expect(state.vars.b).toBe("2");
    expect((state.nodes.loop.output as { items: { email: string }[] }).items[1]).toEqual({ email: "b@x.example", upper: "B!" });
  });

  it("explains missing integrations and permissions in plain language", async () => {
    const { actor } = await createFixtureOrg();
    const sarah = await createFixtureAgent(actor, { "mock_search.company_profile": "ALLOW" });
    await prisma.integrationConnection.updateMany({ where: { orgId: actor.orgId }, data: { status: "DISCONNECTED" } });
    const graph: WorkflowGraph = {
      nodes: [
        { key: "t", type: "trigger.manual", label: "Start", config: {}, position: { x: 0, y: 0 } },
        { key: "s", type: "tool.call", label: "Research", config: { toolKey: "mock_search.company_profile", input: { company: "{{company}}" }, agentId: sarah.id }, position: { x: 0, y: 0 } },
        { key: "orphan", type: "data.set", label: "Orphan", config: { assignments: [{ name: "x", value: "1" }] }, position: { x: 0, y: 0 } },
      ],
      edges: [{ key: "1", source: "t", target: "s" }],
    };
    const wf = await createWorkflow(actor, { name: "Bad", graph });
    const { issues } = await validateDraft(actor.orgId, wf.id, true);
    const text = issues.map((i) => i.message).join("\n");
    expect(text).toContain("Mock Search is not connected");
    expect(text).toContain("can't be reached from the trigger");
    expect(text).toContain("{{trigger.company}}");
  });
});
