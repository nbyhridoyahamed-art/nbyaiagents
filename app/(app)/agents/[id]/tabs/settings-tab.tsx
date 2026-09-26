import { prisma } from "@/lib/db";
import type { AgentWithConfig } from "@/server/services/agents";
import { listProviderStatus } from "@/server/services/ai-providers";
import { MODELS } from "@/lib/ai/models";
import { AgentSettingsForms } from "./settings-forms";

export async function SettingsTab({ agent, orgId, canEdit, section }: { agent: AgentWithConfig; orgId: string; canEdit: boolean; section?: string }) {
  const [departments, providers, others] = await Promise.all([
    prisma.department.findMany({ where: { orgId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    listProviderStatus(orgId),
    prisma.agent.findMany({ where: { orgId, deletedAt: null, id: { not: agent.id } }, select: { id: true, name: true, jobTitle: true }, orderBy: { name: "asc" } }),
  ]);
  const pc = agent.providerConfig;
  return (
    <AgentSettingsForms
      canEdit={canEdit}
      focus={section}
      departments={departments}
      providers={providers}
      models={MODELS.map((m) => ({ id: m.id, provider: m.provider, label: m.label, supportsTemperature: m.supportsTemperature }))}
      others={others}
      agent={{
        id: agent.id,
        name: agent.name,
        jobTitle: agent.jobTitle,
        departmentId: agent.departmentId,
        description: agent.description ?? "",
        avatarColor: agent.avatarColor,
        mission: agent.mission ?? "",
        responsibilities: agent.responsibilities,
        goals: agent.goals,
        kpis: agent.kpis,
        priority: agent.priority,
        personality: agent.personality,
        personalityNotes: agent.personalityNotes ?? "",
        instructions: Object.fromEntries(agent.instructions.map((i) => [i.section, i.content])),
        model: {
          provider: pc?.provider ?? "OFFLINE",
          model: pc?.model ?? "offline-demo",
          fallbackProvider: pc?.fallbackProvider ?? null,
          fallbackModel: pc?.fallbackModel ?? null,
          temperature: pc?.temperature ?? 0.3,
          maxOutputTokens: pc?.maxOutputTokens ?? 4000,
        },
        limits: {
          maxStepsPerRun: agent.maxStepsPerRun,
          maxToolCallsPerRun: agent.maxToolCallsPerRun,
          maxTokensPerRun: agent.maxTokensPerRun,
          maxCostPerRunUsd: agent.maxCostPerRunUsd,
          monthlyBudgetUsd: agent.monthlyBudgetUsd,
          canDelegate: agent.canDelegate,
        },
        delegateIds: agent.delegatesTo.map((d) => d.delegateId),
      }}
    />
  );
}
