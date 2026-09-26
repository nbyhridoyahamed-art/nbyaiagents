import type { PermissionEffect, ProviderKind } from "@/lib/generated/prisma/enums";
import type { InstructionKey } from "@/lib/agents/schema";

/** Immutable configuration an agent version runs with. Stored in AgentVersion.snapshot. */
export interface AgentSnapshot {
  schema: 1;
  version: number;
  name: string;
  jobTitle: string;
  departmentId: string | null;
  departmentName: string | null;
  description: string | null;
  mission: string | null;
  responsibilities: string[];
  goals: string[];
  kpis: string[];
  personality: string;
  personalityNotes: string | null;
  instructions: Partial<Record<InstructionKey, string>>;
  model: {
    provider: ProviderKind;
    model: string;
    fallbackProvider: ProviderKind | null;
    fallbackModel: string | null;
    temperature: number;
    maxOutputTokens: number;
  };
  limits: {
    maxStepsPerRun: number;
    maxToolCallsPerRun: number;
    maxTokensPerRun: number;
    maxCostPerRunUsd: number;
    monthlyBudgetUsd: number;
  };
  canDelegate: boolean;
  delegateIds: string[];
  knowledgeBaseIds: string[];
  tools: { toolId: string; key: string; effect: PermissionEffect }[];
  workflowIds: string[];
}
