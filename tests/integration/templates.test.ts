import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { WORKFLOW_TEMPLATES } from "@/lib/templates/workflows";
import { registerAllJobHandlers } from "@/server/jobs/handlers";
import { drainJobs } from "@/server/jobs/queue";
import { connectIntegration } from "@/server/services/integrations";
import { getTemplateUsage, HIRE_NEW, installWorkflowTemplate, templateReadiness } from "@/server/services/templates";
import { simulateDraft, validateDraft } from "@/server/services/workflows";
import { createFixtureAgent, createFixtureOrg, resetDb } from "./helpers";

beforeAll(() => registerAllJobHandlers());
beforeEach(async () => {
  await resetDb();
});

describe("workflow templates", () => {
  for (const t of WORKFLOW_TEMPLATES) {
    it(`“${t.name}” installs as a draft and simulates end to end`, async () => {
      const { org, actor } = await createFixtureOrg();
      for (const i of ["mock_crm", "mock_email", "mock_calendar", "mock_search", "mock_sheets", "mock_commerce"]) await connectIntegration(actor, i);
      const roles = Object.fromEntries(t.roles.map((r) => [r.key, HIRE_NEW]));
      const res = await installWorkflowTemplate(actor, t.key, { roles });

      expect(res.hired).toHaveLength(t.roles.length);
      const wf = await prisma.workflow.findUniqueOrThrow({ where: { id: res.workflowId } });
      expect(wf).toMatchObject({ status: "DRAFT", templateKey: t.key, templateVersion: t.version });
      const hired = await prisma.agent.findMany({ where: { id: { in: res.hired.map((h) => h.agentId) } } });
      expect(hired.every((a) => a.lifecycle === "DRAFT" && a.templateVersion === 1)).toBe(true);

      const { issues } = await validateDraft(org.id, wf.id, false);
      expect(issues.filter((i) => i.level === "error")).toEqual([]);
      const sim = await simulateDraft(actor, wf.id, t.sampleInput);
      await drainJobs(500);
      const run = await prisma.workflowRun.findUniqueOrThrow({ where: { id: sim.id } });
      expect(run.error ?? null, String(run.error)).toBeNull();
      expect(run.status).toBe("COMPLETED");
    });
  }

  it("uses existing employees, flags approval gaps and tracks usage", async () => {
    const { org, actor } = await createFixtureOrg();
    const sarah = await createFixtureAgent(actor, { "mock_email.send_email": "ALLOW", "mock_search.company_profile": "ALLOW", "mock_crm.create_lead": "ALLOW" });
    const notes = await templateReadiness(org.id, "lead-generation", { sales: sarah.id });
    expect(notes.join(" ")).toContain("without approval");

    const res = await installWorkflowTemplate(actor, "lead-generation", { roles: { sales: sarah.id }, name: "Inbound leads" });
    expect(res.hired).toEqual([]);
    const wf = await prisma.workflow.findUniqueOrThrow({ where: { id: res.workflowId } });
    expect(wf.name).toBe("Inbound leads");
    expect(await prisma.agentWorkflow.count({ where: { workflowId: wf.id, agentId: sarah.id } })).toBe(1);

    const usage = await getTemplateUsage(org.id);
    expect(usage.workflows["lead-generation"]).toMatchObject({ count: 1, outdated: 0 });
    await prisma.workflow.update({ where: { id: wf.id }, data: { templateVersion: 0 } });
    expect((await getTemplateUsage(org.id)).workflows["lead-generation"].outdated).toBe(1);
  });

  it("rejects missing roles and employees from another company", async () => {
    const { actor } = await createFixtureOrg();
    const other = await createFixtureOrg("Other");
    const stranger = await createFixtureAgent(other.actor, {});
    await expect(installWorkflowTemplate(actor, "lead-generation", { roles: {} })).rejects.toSatisfy(isAppError);
    await expect(installWorkflowTemplate(actor, "lead-generation", { roles: { sales: stranger.id } })).rejects.toSatisfy(isAppError);
    await expect(installWorkflowTemplate(actor, "nope", { roles: {} })).rejects.toSatisfy(isAppError);
  });
});
