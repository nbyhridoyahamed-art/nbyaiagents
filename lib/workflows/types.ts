import { z } from "zod";
import { outputSpecSchema } from "@/lib/ai/output-spec";

/**
 * Workflow graph model. The visual editor produces this graph; the engine
 * validates and executes it. Node configs are validated with the schemas below.
 */

export const conditionSchema = z.object({
  left: z.string().max(300).describe("Value or {{variable}}"),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "not_contains", "exists", "not_exists", "in"]),
  right: z.string().max(300).default(""),
});
export type Condition = z.infer<typeof conditionSchema>;

export const conditionGroupSchema = z.object({
  mode: z.enum(["all", "any"]).default("all"),
  conditions: z.array(conditionSchema).min(1).max(10),
});
export type ConditionGroup = z.infer<typeof conditionGroupSchema>;

const retrySchema = z
  .object({ maxAttempts: z.number().int().min(1).max(5).default(1), backoffSeconds: z.number().int().min(1).max(3600).default(30) })
  .default({ maxAttempts: 1, backoffSeconds: 30 });

const common = {
  outputVar: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/, "Use letters, numbers and underscores.")
    .optional()
    .describe("Also save the output as {{var}}"),
  retry: retrySchema.optional(),
  continueOnError: z.boolean().optional(),
};

const aiBase = {
  ...common,
  prompt: z.string().min(1, "Write the instructions for this step.").max(8000),
  outputSpec: outputSpecSchema.optional(),
  provider: z.enum(["ANTHROPIC", "OPENAI", "GOOGLE", "OPENAI_COMPATIBLE", "OFFLINE"]).optional(),
  model: z.string().max(100).optional(),
};

export const NODE_CONFIG_SCHEMAS = {
  "trigger.manual": z.object({ inputFields: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/)).max(20).default([]) }),
  "trigger.schedule": z.object({ cron: z.string().min(9).max(100), timezone: z.string().max(60).optional() }),
  "trigger.webhook": z.object({ requireSignature: z.boolean().default(true) }),
  "trigger.api": z.object({}),
  "trigger.event": z.object({ event: z.enum(["crm.lead.created", "email.received"]) }),

  "ai.prompt": z.object(aiBase),
  "ai.analyze": z.object(aiBase),
  "ai.summarize": z.object({ ...aiBase, prompt: z.string().max(8000).default("Summarize the following:") , input: z.string().max(4000).default("") }),
  "ai.generate": z.object(aiBase),
  "ai.classify": z.object({ ...common, input: z.string().min(1).max(4000), categories: z.array(z.string().min(1).max(60)).min(2).max(20), instructions: z.string().max(2000).default(""), provider: aiBase.provider, model: aiBase.model }),
  "ai.extract": z.object({ ...common, input: z.string().min(1).max(4000), outputSpec: outputSpecSchema, instructions: z.string().max(2000).default(""), provider: aiBase.provider, model: aiBase.model }),
  "ai.decision": z.object({ ...common, question: z.string().min(1).max(2000), options: z.array(z.string().min(1).max(60)).min(2).max(10), provider: aiBase.provider, model: aiBase.model }),
  "ai.research": z.object({ ...common, agentId: z.string().min(1, "Choose the employee who does the research."), topic: z.string().min(1).max(4000) }),

  "agent.run": z.object({ ...common, agentId: z.string().min(1, "Choose an AI employee."), instructions: z.string().min(1, "Tell the employee what to do.").max(8000), outputSpec: outputSpecSchema.optional() }),

  "tool.call": z.object({
    ...common,
    toolKey: z.string().min(1, "Choose a tool."),
    input: z.record(z.string(), z.unknown()).default({}),
    agentId: z.string().optional().describe("Act as this employee (their permissions apply)"),
  }),

  "logic.if": z.object({ condition: conditionGroupSchema }),
  "logic.switch": z.object({
    cases: z.array(z.object({ handle: z.string().regex(/^[a-z0-9_]{1,30}$/), label: z.string().max(60), condition: conditionGroupSchema })).min(1).max(10),
  }),
  "logic.filter": z.object({ condition: conditionGroupSchema }),
  "logic.merge": z.object({ ...common }),
  "logic.parallel": z.object({}),
  "logic.loop": z.object({ ...common, items: z.string().min(1).max(300).describe("{{variable}} holding a list"), maxItems: z.number().int().min(1).max(100).default(25), itemVar: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).default("item") }),
  "logic.delay": z.object({ seconds: z.number().int().min(1).max(30 * 24 * 3600) }),

  "human.approval": z.object({ ...common, title: z.string().min(1).max(200), details: z.string().max(8000).default("") }),
  "human.review": z.object({ ...common, title: z.string().min(1).max(200), content: z.string().min(1).max(20000) }),
  "human.input": z.object({ ...common, question: z.string().min(1).max(2000) }),

  "data.set": z.object({ assignments: z.array(z.object({ name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.]{0,60}$/), value: z.string().max(4000) })).min(1).max(30) }),
  "data.transform": z.object({ ...common, template: z.record(z.string(), z.unknown()) }),
  "data.parse_json": z.object({ ...common, source: z.string().min(1).max(300) }),
  "data.store": z.object({ key: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/), value: z.string().min(1).max(4000) }),

  "flow.end": z.object({ output: z.string().max(4000).default("") }),
} as const;

export type NodeType = keyof typeof NODE_CONFIG_SCHEMAS;
export const NODE_TYPES = Object.keys(NODE_CONFIG_SCHEMAS) as NodeType[];

export type NodeCategory = "Triggers" | "AI" | "Agents" | "Tools" | "Logic" | "Human" | "Data";

export interface NodeMeta {
  type: NodeType;
  label: string;
  category: NodeCategory;
  description: string;
  icon: string;
  /** Output handles; "out" is the default single output. */
  handles: string[] | "dynamic";
  errorHandle?: boolean;
}

export const NODE_CATALOG: NodeMeta[] = [
  { type: "trigger.manual", label: "Manual", category: "Triggers", description: "Start by clicking Run (optionally with inputs).", icon: "play", handles: ["out"] },
  { type: "trigger.schedule", label: "Schedule", category: "Triggers", description: "Run on a schedule in your company timezone.", icon: "clock", handles: ["out"] },
  { type: "trigger.webhook", label: "Webhook", category: "Triggers", description: "Start from a signed HTTP request.", icon: "webhook", handles: ["out"] },
  { type: "trigger.api", label: "API", category: "Triggers", description: "Start from the public API with an API key.", icon: "code", handles: ["out"] },
  { type: "trigger.event", label: "Event", category: "Triggers", description: "New CRM lead or new email in a connected integration.", icon: "zap", handles: ["out"] },

  { type: "ai.prompt", label: "Ask AI", category: "AI", description: "Free-form AI step.", icon: "sparkles", handles: ["out"], errorHandle: true },
  { type: "ai.analyze", label: "Analyze", category: "AI", description: "Analyse data and return findings.", icon: "scan-search", handles: ["out"], errorHandle: true },
  { type: "ai.summarize", label: "Summarize", category: "AI", description: "Condense text.", icon: "text", handles: ["out"], errorHandle: true },
  { type: "ai.classify", label: "Classify", category: "AI", description: "Pick one category.", icon: "tags", handles: ["out"], errorHandle: true },
  { type: "ai.extract", label: "Extract", category: "AI", description: "Pull structured fields out of text.", icon: "brackets", handles: ["out"], errorHandle: true },
  { type: "ai.generate", label: "Generate", category: "AI", description: "Write content (emails, posts, replies).", icon: "pen-line", handles: ["out"], errorHandle: true },
  { type: "ai.research", label: "Research", category: "AI", description: "An employee researches a topic with their tools.", icon: "search", handles: ["out"], errorHandle: true },
  { type: "ai.decision", label: "Decision", category: "AI", description: "AI chooses a path; branch on the result.", icon: "git-fork", handles: ["out"], errorHandle: true },

  { type: "agent.run", label: "Run AI Employee", category: "Agents", description: "Hand this step to an employee (their knowledge, tools and permissions apply).", icon: "user-round", handles: ["out"], errorHandle: true },

  { type: "tool.call", label: "Tool", category: "Tools", description: "Call a tool or integration (permission-checked).", icon: "wrench", handles: ["out"], errorHandle: true },

  { type: "logic.if", label: "If / Else", category: "Logic", description: "Branch on a condition.", icon: "split", handles: ["true", "false"] },
  { type: "logic.switch", label: "Switch", category: "Logic", description: "Branch on several cases.", icon: "list-tree", handles: "dynamic" },
  { type: "logic.filter", label: "Filter", category: "Logic", description: "Continue only if the condition holds.", icon: "filter", handles: ["out"] },
  { type: "logic.merge", label: "Merge", category: "Logic", description: "Wait for branches and combine them.", icon: "merge", handles: ["out"] },
  { type: "logic.loop", label: "Loop", category: "Logic", description: "Repeat the connected steps for each item in a list.", icon: "repeat", handles: ["each", "done"] },
  { type: "logic.parallel", label: "Parallel", category: "Logic", description: "Run the next steps side by side.", icon: "columns-3", handles: ["out"] },
  { type: "logic.delay", label: "Delay", category: "Logic", description: "Wait before continuing.", icon: "hourglass", handles: ["out"] },

  { type: "human.approval", label: "Approval", category: "Human", description: "Pause until a human approves or rejects.", icon: "hand", handles: ["approved", "rejected"] },
  { type: "human.review", label: "Review", category: "Human", description: "A human reviews (and may edit) content.", icon: "file-check", handles: ["approved", "rejected"] },
  { type: "human.input", label: "Input Request", category: "Human", description: "Ask a human for information.", icon: "message-circle-question", handles: ["out"] },

  { type: "data.set", label: "Set Variable", category: "Data", description: "Set {{variables}}.", icon: "variable", handles: ["out"] },
  { type: "data.transform", label: "Transform", category: "Data", description: "Reshape data with a template.", icon: "shuffle", handles: ["out"] },
  { type: "data.parse_json", label: "Parse JSON", category: "Data", description: "Turn JSON text into data.", icon: "braces", handles: ["out"], errorHandle: true },
  { type: "data.store", label: "Store Result", category: "Data", description: "Save a value in the run's results.", icon: "database", handles: ["out"] },
  { type: "flow.end", label: "End", category: "Logic", description: "Finish the workflow with an output.", icon: "flag", handles: [] },
];

export function nodeMeta(type: string): NodeMeta | undefined {
  return NODE_CATALOG.find((n) => n.type === type);
}

export function isTrigger(type: string) {
  return type.startsWith("trigger.");
}

export interface GraphNode {
  key: string;
  type: NodeType;
  label: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface GraphEdge {
  key: string;
  source: string;
  target: string;
  /** Output handle on the source ("out", "true", "false", "approved", "error", switch case…). */
  sourceHandle?: string | null;
  label?: string | null;
}

export interface WorkflowGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface WorkflowSettings {
  maxSteps: number;
  maxToolCalls: number;
  maxTokens: number;
  maxCostUsd: number;
  timeoutMinutes: number;
  defaultAgentId?: string | null;
}

export const DEFAULT_SETTINGS: WorkflowSettings = { maxSteps: 100, maxToolCalls: 50, maxTokens: 400_000, maxCostUsd: 5, timeoutMinutes: 24 * 60 };

export const workflowSettingsSchema = z.object({
  maxSteps: z.number().int().min(1).max(1000).default(100),
  maxToolCalls: z.number().int().min(0).max(500).default(50),
  maxTokens: z.number().int().min(1000).max(10_000_000).default(400_000),
  maxCostUsd: z.number().min(0).max(1000).default(5),
  timeoutMinutes: z.number().int().min(1).max(30 * 24 * 60).default(24 * 60),
  defaultAgentId: z.string().nullable().optional(),
});

export const graphSchema = z.object({
  nodes: z
    .array(
      z.object({
        key: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
        type: z.enum(NODE_TYPES as [NodeType, ...NodeType[]]),
        label: z.string().min(1).max(80),
        config: z.record(z.string(), z.unknown()).default({}),
        position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
      }),
    )
    .max(200),
  edges: z
    .array(
      z.object({
        key: z.string().min(1).max(120),
        source: z.string().min(1).max(40),
        target: z.string().min(1).max(40),
        sourceHandle: z.string().max(40).nullable().optional(),
        label: z.string().max(60).nullable().optional(),
      }),
    )
    .max(400),
});
