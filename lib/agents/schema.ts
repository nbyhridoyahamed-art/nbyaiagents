import { z } from "zod";
import { ALL_PROVIDERS } from "@/lib/ai/provider-presets";

export const PERSONALITIES = [
  { key: "professional", label: "Professional", description: "Polished, clear and courteous." },
  { key: "friendly", label: "Friendly", description: "Warm and approachable." },
  { key: "concise", label: "Concise", description: "Short, to-the-point answers." },
  { key: "detailed", label: "Detailed", description: "Thorough explanations." },
  { key: "analytical", label: "Analytical", description: "Data-driven and precise." },
  { key: "persuasive", label: "Persuasive", description: "Compelling and benefit-focused." },
  { key: "creative", label: "Creative", description: "Imaginative and original." },
  { key: "formal", label: "Formal", description: "Traditional business register." },
  { key: "casual", label: "Casual", description: "Relaxed and conversational." },
] as const;

export type PersonalityKey = (typeof PERSONALITIES)[number]["key"];
export const personalityKeys = PERSONALITIES.map((p) => p.key) as [PersonalityKey, ...PersonalityKey[]];

export const INSTRUCTION_SECTIONS = [
  { key: "ROLE", label: "Role", placeholder: "Who this employee is and who they work for." },
  { key: "MISSION", label: "Mission", placeholder: "The outcome this employee exists to achieve." },
  { key: "RESPONSIBILITIES", label: "Responsibilities", placeholder: "What they own day to day." },
  { key: "RULES", label: "Rules", placeholder: "General rules of conduct." },
  { key: "MUST_DO", label: "Things you must do", placeholder: "Non-negotiable behaviours." },
  { key: "MUST_NEVER", label: "Things you must never do", placeholder: "Hard limits." },
  { key: "TONE", label: "Tone", placeholder: "How they should sound." },
  { key: "DECISION_RULES", label: "Decision rules", placeholder: "How to decide between options." },
  { key: "ESCALATION_RULES", label: "Escalation rules", placeholder: "When to hand over to a human." },
  { key: "TOOL_USAGE_RULES", label: "Tool usage rules", placeholder: "How and when to use tools." },
  { key: "KNOWLEDGE_RULES", label: "Knowledge rules", placeholder: "How to use company knowledge." },
  { key: "OUTPUT_FORMAT", label: "Output format", placeholder: "How results should be structured." },
] as const;

export type InstructionKey = (typeof INSTRUCTION_SECTIONS)[number]["key"];
export const instructionKeys = INSTRUCTION_SECTIONS.map((s) => s.key) as [InstructionKey, ...InstructionKey[]];

const lines = z
  .array(z.string().trim().min(1).max(300))
  .max(20)
  .default([]);

export const agentIdentitySchema = z.object({
  name: z.string().trim().min(1, "Give your employee a name.").max(60),
  jobTitle: z.string().trim().min(1, "Add a job title.").max(80),
  departmentId: z.string().max(40).nullable().optional(),
  description: z.string().trim().max(500).optional().default(""),
  avatarColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour.")
    .default("#5B5FEF"),
});

export const agentRoleSchema = z.object({
  mission: z.string().trim().max(500).optional().default(""),
  responsibilities: lines,
  goals: lines,
  kpis: lines,
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
});

export const agentPersonalitySchema = z.object({
  personality: z.enum(personalityKeys).default("professional"),
  personalityNotes: z.string().trim().max(1000).optional().default(""),
});

export const instructionsSchema = z.partialRecord(z.enum(instructionKeys), z.string().max(4000));

export const modelConfigSchema = z.object({
  provider: z.enum(ALL_PROVIDERS),
  model: z.string().trim().min(1).max(100),
  fallbackProvider: z.enum(ALL_PROVIDERS).nullable().optional(),
  fallbackModel: z.string().trim().max(100).nullable().optional(),
  temperature: z.number().min(0).max(1).default(0.3),
  maxOutputTokens: z.number().int().min(256).max(64000).default(4000),
});

export const limitsSchema = z.object({
  maxStepsPerRun: z.number().int().min(1).max(50).default(12),
  maxToolCallsPerRun: z.number().int().min(0).max(50).default(8),
  maxTokensPerRun: z.number().int().min(1000).max(2_000_000).default(60000),
  maxCostPerRunUsd: z.number().min(0).max(100).default(1),
  monthlyBudgetUsd: z.number().min(0).max(100000).default(25),
  canDelegate: z.boolean().default(false),
});

export const toolAssignmentSchema = z.object({
  toolId: z.string().min(1).max(40),
  effect: z.enum(["ALLOW", "REQUIRE_APPROVAL", "DENY"]),
});

export const createAgentSchema = agentIdentitySchema
  .extend(agentRoleSchema.shape)
  .extend(agentPersonalitySchema.shape)
  .extend({
    instructions: instructionsSchema.default({}),
    model: modelConfigSchema.optional(),
    knowledgeBaseIds: z.array(z.string().max(40)).max(50).default([]),
    tools: z.array(toolAssignmentSchema).max(100).default([]),
    workflowIds: z.array(z.string().max(40)).max(50).default([]),
    limits: limitsSchema.partial().optional(),
    templateKey: z.string().max(60).optional(),
  });

export type CreateAgentInput = z.input<typeof createAgentSchema>;
export type CreateAgentData = z.output<typeof createAgentSchema>;

/**
 * Keeps only the keys a caller actually sent from the result of parsing a partial update.
 *
 * `schema.partial()` is not a patch: Zod 4 still fills every omitted field with its `.default(...)`, so a save that
 * only named `model` and `limits` parsed into a blank mission, no responsibilities or goals, the "professional"
 * personality, medium priority and the first avatar colour — and writing that back wiped the employee's role.
 * An explicit `""` or `[]` still counts as sent, so a field can be cleared on purpose.
 */
export function onlySent<T extends object>(parsed: T, sent: object): Partial<T> {
  const given = sent as Record<string, unknown>;
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => given[key] !== undefined)) as Partial<T>;
}

export const AVATAR_COLORS = ["#5B5FEF", "#7C5CFC", "#12B76A", "#F79009", "#2E90FA", "#EE46BC", "#0E9384", "#475467", "#DD2590", "#6172F3"];
