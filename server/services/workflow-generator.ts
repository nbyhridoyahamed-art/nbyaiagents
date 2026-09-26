import { prisma } from "@/lib/db";
import { callModel } from "@/lib/ai/router";
import { extractJson } from "@/lib/ai/output-spec";
import type { JsonSchema } from "@/lib/ai/types";
import { tokenize } from "@/lib/knowledge/embeddings";
import { autoLayout } from "@/lib/workflows/auto-layout";
import { NODE_CATALOG, NODE_CONFIG_SCHEMAS, type NodeType, type WorkflowGraph } from "@/lib/workflows/types";
import type { GraphIssue } from "@/lib/workflows/validate-graph";
import { WORKFLOW_TEMPLATES } from "@/lib/templates/workflows";
import { defaultModelFor } from "@/server/services/ai-providers";
import { getDisabled } from "@/server/services/platform-settings";
import { validateWorkflowGraph } from "@/server/workflows/validate";

/**
 * Workflow generator (spec §40): describe a process in plain language, get a draft
 * graph to review. It is never saved or activated automatically — the user previews
 * it, creates it as a draft, tests it and publishes it themselves.
 */

export interface GeneratedWorkflow {
  name: string;
  summary: string;
  graph: WorkflowGraph;
  source: "ai" | "template_match";
  templateKey?: string;
  notes: string[];
  issues: GraphIssue[];
}

// Step types the generator may use (kept to well-understood, safe building blocks).
const ALLOWED: NodeType[] = [
  "trigger.manual",
  "trigger.webhook",
  "trigger.schedule",
  "trigger.event",
  "agent.run",
  "ai.research",
  "ai.generate",
  "ai.classify",
  "ai.decision",
  "tool.call",
  "logic.if",
  "human.approval",
  "human.review",
  "human.input",
  "data.set",
];

const RESPONSE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    summary: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string", description: "short snake_case id" },
          type: { type: "string", enum: ALLOWED },
          label: { type: "string" },
          config_json: { type: "string", description: "JSON object with this step's settings" },
        },
        required: ["key", "type", "label", "config_json"],
        additionalProperties: false,
      },
    },
    connections: {
      type: "array",
      items: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" }, output: { type: "string", description: "out, true/false, approved/rejected" } },
        required: ["from", "to", "output"],
        additionalProperties: false,
      },
    },
  },
  required: ["name", "summary", "steps", "connections"],
  additionalProperties: false,
};

interface RawPlan {
  name?: string;
  summary?: string;
  steps?: { key?: string; type?: string; label?: string; config_json?: string }[];
  connections?: { from?: string; to?: string; output?: string }[];
}

async function orgCatalog(orgId: string) {
  const [agents, tools] = await Promise.all([
    prisma.agent.findMany({ where: { orgId, deletedAt: null }, select: { id: true, name: true, jobTitle: true, templateKey: true } }),
    prisma.tool.findMany({ where: { orgId, deletedAt: null, enabled: true }, select: { key: true, name: true } }),
  ]);
  return { agents, tools };
}

/** Turns the model's plan into a graph using only this org's real employees and tools. */
function planToGraph(plan: RawPlan, catalog: Awaited<ReturnType<typeof orgCatalog>>): { graph: WorkflowGraph; problems: string[] } {
  const problems: string[] = [];
  const keys = new Set<string>();
  const nodes: Omit<WorkflowGraph["nodes"][number], "position">[] = [];
  for (const [i, s] of (plan.steps ?? []).slice(0, 25).entries()) {
    const type = s.type as NodeType;
    if (!ALLOWED.includes(type)) {
      problems.push(`Step ${i + 1} uses an unsupported type "${s.type}".`);
      continue;
    }
    let key = (s.key ?? `step_${i + 1}`).toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) || `step_${i + 1}`;
    while (keys.has(key)) key = `${key}_${i}`;
    keys.add(key);
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(s.config_json || "{}");
    } catch {
      problems.push(`“${s.label}” had unreadable settings.`);
    }
    // Employees are referenced by name in the plan; map to this org's IDs.
    const agentName = typeof config.agent_name === "string" ? config.agent_name : typeof config.agentName === "string" ? config.agentName : null;
    delete config.agent_name;
    delete config.agentName;
    if (agentName) {
      const agent = catalog.agents.find((a) => a.name.toLowerCase() === agentName.toLowerCase());
      if (agent) config.agentId = agent.id;
      else problems.push(`“${s.label}” mentions an employee named ${agentName}, who doesn't exist — choose one in the builder.`);
    } else if (typeof config.agentId === "string" && !catalog.agents.some((a) => a.id === config.agentId)) {
      delete config.agentId;
    }
    if (type === "tool.call" && typeof config.toolKey === "string" && !catalog.tools.some((t) => t.key === config.toolKey)) {
      problems.push(`“${s.label}” needs a tool (${config.toolKey}) that isn't available — pick one in the builder.`);
      delete config.toolKey;
    }
    const parsed = NODE_CONFIG_SCHEMAS[type].safeParse(config);
    nodes.push({ key, type, label: (s.label ?? NODE_CATALOG.find((n) => n.type === type)?.label ?? type).slice(0, 80), config: parsed.success ? (parsed.data as Record<string, unknown>) : config });
  }
  const edges = (plan.connections ?? [])
    .filter((c) => c.from && c.to && keys.has(c.from) && keys.has(c.to) && c.from !== c.to)
    .slice(0, 60)
    .map((c, i) => ({ key: `e${i + 1}`, source: c.from!, target: c.to!, sourceHandle: c.output && c.output !== "out" ? c.output : "out" }));
  return { graph: { nodes: autoLayout(nodes, edges), edges }, problems };
}

async function fromTemplate(orgId: string, description: string): Promise<GeneratedWorkflow> {
  const catalog = await orgCatalog(orgId);
  const disabled = await getDisabled("templates.disabled");
  const words = new Set(tokenize(description));
  const candidates = WORKFLOW_TEMPLATES.filter((t) => !disabled.includes(t.key));
  const best = candidates
    .map((t) => ({ t, score: tokenize(`${t.name} ${t.summary} ${t.stages.join(" ")} ${t.category}`).filter((w) => words.has(w)).length }))
    .sort((a, b) => b.score - a.score)[0]?.t;
  if (!best) throw new Error("No workflow templates are available.");
  const notes: string[] = [`No AI provider is connected, so this is the closest template (“${best.name}”) matched by keywords — not a custom design. Adjust the steps in the builder, or connect an AI provider for tailored drafts.`];
  const roles: Record<string, string> = {};
  for (const r of best.roles) {
    const agent = catalog.agents.find((a) => a.templateKey === r.agentTemplate) ?? catalog.agents.find((a) => tokenize(a.jobTitle).some((w) => tokenize(r.label).includes(w)));
    if (agent) roles[r.key] = agent.id;
    else notes.push(`Nobody fills the “${r.label}” role yet — choose an employee for those steps in the builder, or hire one from the ${best.name} template.`);
  }
  const graph = best.build(roles);
  // Remove dangling agent IDs for unfilled roles so validation explains what to choose.
  for (const n of graph.nodes) if ("agentId" in n.config && !n.config.agentId) delete n.config.agentId;
  return { name: best.name, summary: best.summary, graph, source: "template_match", templateKey: best.key, notes, issues: await validateWorkflowGraph(orgId, graph, { forPublish: false }) };
}

export async function generateWorkflowDraft(orgId: string, description: string): Promise<GeneratedWorkflow> {
  const text = description.trim().slice(0, 4000);
  const model = await defaultModelFor(orgId);
  if (model.provider === "OFFLINE") return fromTemplate(orgId, text);

  const catalog = await orgCatalog(orgId);
  const system = [
    "You design automation workflows as a graph of steps for a business platform. Return JSON only.",
    `Allowed step types and their config fields:\n${ALLOWED.map((t) => `- ${t}: ${Object.keys((NODE_CONFIG_SCHEMAS[t] as unknown as { shape?: Record<string, unknown> }).shape ?? {}).join(", ") || "(none)"}`).join("\n")}`,
    `For employee steps (agent.run, ai.research) put the employee's name in config "agent_name". Employees: ${catalog.agents.map((a) => `${a.name} (${a.jobTitle})`).join("; ") || "none yet"}.`,
    `For tool.call use one of these toolKey values: ${catalog.tools.map((t) => `${t.key} (${t.name})`).join("; ") || "none"}.`,
    "Use {{trigger.field}} and {{nodes.<key>.text}} to pass data between steps. Start with exactly one trigger. Branch with logic.if (outputs true/false) or human.approval/human.review (outputs approved/rejected).",
    "Any step that sends messages, publishes, deletes or spends money must come after a human.approval or human.review step. Never design anything that bypasses human approval for those actions.",
  ].join("\n\n");

  let messages = [{ role: "user" as const, content: [{ type: "text" as const, text: `Design this workflow:\n\n${text}` }] }];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await callModel(
        orgId,
        { provider: model.provider, model: model.model, fallbackProvider: null, fallbackModel: null, temperature: 0.2, maxOutputTokens: 4000 },
        { system, messages, responseSchema: { name: "workflow_plan", schema: RESPONSE_SCHEMA } },
      );
      const out = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      const plan = extractJson(out) as RawPlan;
      const { graph, problems } = planToGraph(plan, catalog);
      const issues = await validateWorkflowGraph(orgId, graph, { forPublish: false });
      const errors = issues.filter((i) => i.level === "error");
      if (errors.length && attempt === 0) {
        messages = [
          ...messages,
          { role: "user" as const, content: [{ type: "text" as const, text: `That plan has problems:\n${[...problems, ...errors.map((e) => e.message)].join("\n")}\nReturn a corrected plan.` }] },
        ];
        continue;
      }
      return {
        name: (plan.name ?? "New workflow").slice(0, 120),
        summary: (plan.summary ?? "").slice(0, 500),
        graph,
        source: "ai",
        notes: ["Drafted by AI from your description. Review every step, run a test, then publish — nothing is active until you do.", ...problems],
        issues,
      };
    } catch (err) {
      if (attempt === 1) {
        const fallback = await fromTemplate(orgId, text);
        fallback.notes.unshift(`The AI couldn't produce a valid plan (${(err as Error).message.slice(0, 120)}), so a template was used instead.`);
        return fallback;
      }
    }
  }
  return fromTemplate(orgId, text);
}
