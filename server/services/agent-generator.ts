import { prisma } from "@/lib/db";
import { callModel } from "@/lib/ai/router";
import { outputJsonSchema, validateOutput, type OutputSpec } from "@/lib/ai/output-spec";
import { tokenize } from "@/lib/knowledge/embeddings";
import { AGENT_TEMPLATES } from "@/lib/templates/agents";
import { PERSONALITIES, type CreateAgentInput } from "@/lib/agents/schema";
import { defaultModelFor } from "@/server/services/ai-providers";
import { effectiveToolMeta } from "@/server/tools/executor";

export interface GeneratedDraft {
  input: CreateAgentInput;
  source: "ai" | "template_match";
  nameSuggestions: string[];
  recommendedKnowledge: string[];
  workflowIdeas: string[];
  notes: string;
}

const SPEC: OutputSpec = {
  name: "agent_draft",
  fields: [
    { name: "name_suggestions", type: "string_array", description: "3 short first-name suggestions", required: true },
    { name: "job_title", type: "string", description: "Job title", required: true },
    { name: "department", type: "string", description: "Best matching department name", required: true },
    { name: "summary", type: "string", description: "One-sentence description", required: true },
    { name: "mission", type: "string", description: "Mission statement", required: true },
    { name: "responsibilities", type: "string_array", description: "3-6 responsibilities", required: true },
    { name: "goals", type: "string_array", description: "2-4 measurable goals", required: true },
    { name: "kpis", type: "string_array", description: "2-4 KPIs", required: true },
    { name: "personality", type: "string", enum: PERSONALITIES.map((p) => p.key), description: "Communication style", required: true },
    { name: "role_instructions", type: "string", description: "Role section of the instructions", required: true },
    { name: "rules", type: "string", description: "General rules", required: true },
    { name: "must_do", type: "string", description: "Things the employee must always do", required: true },
    { name: "must_never", type: "string", description: "Hard limits", required: true },
    { name: "tone", type: "string", description: "Tone guidance", required: true },
    { name: "escalation_rules", type: "string", description: "When to escalate to a human", required: true },
    { name: "recommended_knowledge", type: "string_array", description: "Knowledge documents this employee should have", required: true },
    { name: "recommended_tool_keys", type: "string_array", description: "Keys of available tools this employee should use", required: true },
    { name: "workflow_ideas", type: "string_array", description: "Automations this employee could run", required: true },
  ],
};

/** Conservative permission recommendation — never auto-allows high-impact actions. */
function recommendEffect(risk: string, capabilities: string[]): "ALLOW" | "REQUIRE_APPROVAL" | "DENY" {
  if (risk === "CRITICAL" || capabilities.includes("financial") || capabilities.includes("data_deletion")) return "DENY";
  if (risk !== "LOW" || capabilities.includes("external_communication") || capabilities.includes("bulk_outreach")) return "REQUIRE_APPROVAL";
  return "ALLOW";
}

export async function generateAgentDraft(orgId: string, description: string): Promise<GeneratedDraft> {
  const [departments, tools] = await Promise.all([
    prisma.department.findMany({ where: { orgId, deletedAt: null }, select: { id: true, name: true } }),
    prisma.tool.findMany({ where: { orgId, deletedAt: null, enabled: true } }),
  ]);
  const model = await defaultModelFor(orgId);

  const toolAssignments = (keys: string[]) =>
    tools
      .filter((t) => keys.includes(t.key))
      .map((t) => {
        const meta = effectiveToolMeta(t);
        return { toolId: t.id, effect: recommendEffect(meta.riskLevel, meta.capabilities) };
      });

  if (model.provider === "OFFLINE") {
    // No AI available: pick the closest template by keyword overlap — and say so.
    const words = new Set(tokenize(description));
    const best = AGENT_TEMPLATES.map((t) => ({
      t,
      score: tokenize(`${t.jobTitle} ${t.summary} ${t.responsibilities.join(" ")} ${t.department}`).filter((w) => words.has(w)).length,
    })).sort((a, b) => b.score - a.score)[0].t;
    const dept = departments.find((d) => d.name.toLowerCase() === best.department.toLowerCase());
    return {
      source: "template_match",
      nameSuggestions: [best.suggestedName],
      recommendedKnowledge: best.suggestedKnowledge,
      workflowIdeas: best.suggestedWorkflows,
      notes: `No AI provider is connected, so this draft was matched to the closest template ("${best.jobTitle}") by keywords. Review every section — connect an AI provider for tailored drafts.`,
      input: {
        name: best.suggestedName,
        jobTitle: best.jobTitle,
        departmentId: dept?.id ?? null,
        description: `${best.summary} (Requested: ${description.slice(0, 200)})`,
        avatarColor: best.color,
        mission: best.mission,
        responsibilities: best.responsibilities,
        goals: best.goals,
        kpis: best.kpis,
        personality: best.personality as CreateAgentInput["personality"],
        instructions: best.instructions,
        tools: toolAssignments(best.suggestedTools.map((s) => s.toolKey)),
        templateKey: best.key,
      },
    };
  }

  const res = await callModel(
    orgId,
    { provider: model.provider, model: model.model, fallbackProvider: null, fallbackModel: null, temperature: 0.4, maxOutputTokens: 4000 },
    {
      system: `You design AI employees for a business automation platform. Produce a practical, specific configuration. Recommend only tools from this list (by key): ${
        tools.map((t) => `${t.key} (${t.name})`).join(", ") || "none available"
      }. Departments available: ${departments.map((d) => d.name).join(", ")}. Never recommend sending, deleting or paying without human approval.`,
      messages: [{ role: "user", content: [{ type: "text", text: `Create this AI employee:\n\n${description}` }] }],
      responseSchema: { name: SPEC.name, schema: outputJsonSchema(SPEC) },
    },
  );
  const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const check = validateOutput(SPEC, text);
  if (!check.ok) throw new Error(`The AI returned an invalid draft: ${check.error}`);
  const v = check.value;
  const s = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
  const a = (k: string) => (Array.isArray(v[k]) ? (v[k] as string[]).slice(0, 20) : []);
  const dept = departments.find((d) => d.name.toLowerCase() === s("department").toLowerCase());
  return {
    source: "ai",
    nameSuggestions: a("name_suggestions"),
    recommendedKnowledge: a("recommended_knowledge"),
    workflowIdeas: a("workflow_ideas"),
    notes: "Drafted by AI. Nothing is active until you review and hire — high-impact actions start as “requires approval” or “denied”.",
    input: {
      name: (a("name_suggestions")[0] ?? "New employee").slice(0, 60),
      jobTitle: s("job_title").slice(0, 80),
      departmentId: dept?.id ?? null,
      description: s("summary").slice(0, 500),
      mission: s("mission").slice(0, 500),
      responsibilities: a("responsibilities"),
      goals: a("goals"),
      kpis: a("kpis"),
      personality: s("personality") as CreateAgentInput["personality"],
      instructions: { ROLE: s("role_instructions"), RULES: s("rules"), MUST_DO: s("must_do"), MUST_NEVER: s("must_never"), TONE: s("tone"), ESCALATION_RULES: s("escalation_rules") },
      tools: toolAssignments(a("recommended_tool_keys")),
    },
  };
}
