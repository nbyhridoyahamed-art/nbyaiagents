import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { publishAgent, updateAgentProfile, validateAgent } from "@/server/services/agents";
import { createFixtureAgent, createFixtureOrg, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
});

const ROLE = {
  description: "Researches keywords, audits content and recommends SEO improvements.",
  mission: "Grow organic search traffic with evidence-based recommendations.",
  responsibilities: ["Keyword research", "Content gap analysis", "On-page recommendations"],
  goals: ["Maintain a prioritised keyword list", "Recommend improvements weekly"],
  kpis: ["Keywords analysed", "Recommendations accepted"],
  personality: "analytical" as const,
  personalityNotes: "Lead with the evidence.",
  priority: "HIGH" as const,
  avatarColor: "#7C5CFC",
};

async function load(agentId: string) {
  return prisma.agent.findUniqueOrThrow({ where: { id: agentId }, include: { providerConfig: true } });
}

describe("updating an AI employee", () => {
  it("keeps the role, personality and look when only the model and limits are saved", async () => {
    const { actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {}, { ...ROLE, limits: { maxToolCallsPerRun: 15 } });

    // This is exactly what the Settings → "Model & limits" card sends.
    await updateAgentProfile(actor, agent.id, {
      model: { provider: "GROQ", model: "openai/gpt-oss-120b", fallbackProvider: null, fallbackModel: null, temperature: 0.3, maxOutputTokens: 4000 },
      limits: { maxStepsPerRun: 12, maxToolCallsPerRun: 15, maxTokensPerRun: 60000, maxCostPerRunUsd: 1, monthlyBudgetUsd: 25, canDelegate: false },
    });

    const after = await load(agent.id);
    expect(after).toMatchObject(ROLE);
    expect(after.providerConfig).toMatchObject({ provider: "GROQ", model: "openai/gpt-oss-120b" });
    // …so the readiness check doesn't suddenly say "needs a mission or at least one responsibility".
    expect((await validateAgent(actor.orgId, agent.id)).filter((i) => i.area === "role")).toEqual([]);
  });

  it("can still be published after the model is changed", async () => {
    const { actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {}, ROLE);

    await updateAgentProfile(actor, agent.id, {
      model: { provider: "OFFLINE", model: "offline-demo", fallbackProvider: null, fallbackModel: null, temperature: 0.5, maxOutputTokens: 2000 },
      limits: { maxStepsPerRun: 12, maxToolCallsPerRun: 8, maxTokensPerRun: 60000, maxCostPerRunUsd: 1, monthlyBudgetUsd: 25, canDelegate: false },
    });

    await expect(publishAgent(actor, agent.id)).resolves.toMatchObject({ version: 2 });
    const live = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, version: 2 } });
    expect(live.snapshot).toMatchObject({ mission: ROLE.mission, responsibilities: ROLE.responsibilities, personality: "analytical" });
  });

  it("changes only the limits that were sent", async () => {
    const { actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {}, { ...ROLE, limits: { maxStepsPerRun: 20, maxToolCallsPerRun: 15, maxTokensPerRun: 90000, monthlyBudgetUsd: 40 } });

    await updateAgentProfile(actor, agent.id, { limits: { maxStepsPerRun: 30 } });

    const after = await load(agent.id);
    expect(after).toMatchObject({ maxStepsPerRun: 30, maxToolCallsPerRun: 15, maxTokensPerRun: 90000, monthlyBudgetUsd: 40, canDelegate: false });
  });

  it("changes only the profile fields that were sent", async () => {
    const { actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {}, ROLE);

    await updateAgentProfile(actor, agent.id, { mission: "Rank the store's category pages." });

    const after = await load(agent.id);
    expect(after).toMatchObject({ ...ROLE, mission: "Rank the store's category pages." });
  });

  it("still lets someone clear a field on purpose", async () => {
    const { actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {}, ROLE);

    await updateAgentProfile(actor, agent.id, { goals: [], personalityNotes: "", description: "" });

    const after = await load(agent.id);
    expect(after).toMatchObject({ ...ROLE, goals: [], personalityNotes: "", description: "" });
  });

  it("saves the whole profile form", async () => {
    const { actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {}, { mission: "Old mission", responsibilities: ["Old"] });

    await updateAgentProfile(actor, agent.id, { name: "Alex", jobTitle: "SEO Specialist", ...ROLE });

    expect(await load(agent.id)).toMatchObject({ name: "Alex", jobTitle: "SEO Specialist", ...ROLE });
  });

  it("starts a new draft version without touching what is live", async () => {
    const { actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {}, ROLE);

    await updateAgentProfile(actor, agent.id, { limits: { maxToolCallsPerRun: 24 } });

    const after = await load(agent.id);
    expect(after.publishedVersion).toBe(1);
    expect(after.draftVersion).toBe(2);
    const live = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, version: 1 } });
    expect(live.snapshot).toMatchObject({ mission: ROLE.mission, limits: { maxToolCallsPerRun: 8 } });
  });
});
