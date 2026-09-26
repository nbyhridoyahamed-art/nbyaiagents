import { beforeEach, describe, expect, it } from "vitest";
import { guessIntent } from "@/components/layout/ask-nby";
import { autoLayout } from "@/lib/workflows/auto-layout";
import { generateWorkflowDraft } from "@/server/services/workflow-generator";
import { createFixtureAgent, createFixtureOrg, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
});

describe("Ask NBY AI", () => {
  it("guesses whether the person wants an employee or a workflow", () => {
    expect(guessIntent("Create a customer support employee who answers refund questions")).toBe("employee");
    expect(guessIntent("Whenever a new lead arrives, research it and email them")).toBe("workflow");
    expect(guessIntent("Build a lead generation workflow for my sales agent")).toBe("workflow");
    expect(guessIntent("hello there")).toBeNull();
  });
});

describe("workflow generator", () => {
  it("lays generated steps out left to right by dependency", () => {
    const nodes = autoLayout(
      [
        { key: "t", type: "trigger.manual", label: "t", config: {} },
        { key: "a", type: "data.set", label: "a", config: {} },
        { key: "b", type: "data.set", label: "b", config: {} },
        { key: "c", type: "data.set", label: "c", config: {} },
      ],
      [
        { source: "t", target: "a" },
        { source: "t", target: "b" },
        { source: "a", target: "c" },
        { source: "b", target: "c" },
      ],
    );
    const x = Object.fromEntries(nodes.map((n) => [n.key, n.position.x]));
    expect(x.t).toBeLessThan(x.a);
    expect(x.a).toBe(x.b);
    expect(x.c).toBeGreaterThan(x.a);
    const ab = nodes.filter((n) => n.key === "a" || n.key === "b").map((n) => n.position.y);
    expect(ab[0]).not.toBe(ab[1]);
  });

  it("without an AI provider, honestly offers the closest template wired to existing employees", async () => {
    const { org, actor } = await createFixtureOrg();
    const sarah = await createFixtureAgent(actor, {}, { name: "Sarah", jobTitle: "Sales Representative", templateKey: "sales-representative" });
    const draft = await generateWorkflowDraft(org.id, "When a new lead comes in, research the company, score it and email them after my approval");
    expect(draft.source).toBe("template_match");
    expect(draft.templateKey).toBe("lead-generation");
    expect(draft.notes[0]).toMatch(/closest template/i);
    const agentIds = draft.graph.nodes.map((n) => n.config.agentId).filter(Boolean);
    expect(agentIds.length).toBeGreaterThan(0);
    expect(agentIds.every((id) => id === sarah.id)).toBe(true);
    // Nothing was saved: generating is a preview only.
    const { prisma } = await import("@/lib/db");
    expect(await prisma.workflow.count({ where: { orgId: org.id } })).toBe(0);
  });
});
