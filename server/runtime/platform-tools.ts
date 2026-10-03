import type { AIToolDefinition } from "@/lib/ai/types";
import type { AgentSnapshot } from "@/lib/agents/snapshot";

/**
 * Built-in platform tools every employee has (internal, low-risk actions).
 * External actions always go through the tool registry + permission engine.
 */
export const PLATFORM_TOOL_NAMES = {
  searchKnowledge: "vdo_search_knowledge",
  remember: "vdo_remember",
  askHuman: "vdo_ask_human",
  escalate: "vdo_escalate",
  delegate: "vdo_delegate",
} as const;

export function platformToolDefinitions(snapshot: AgentSnapshot, opts: { hasKnowledge: boolean; allowQuestions: boolean; delegates: { id: string; name: string; jobTitle: string }[] }): AIToolDefinition[] {
  const defs: AIToolDefinition[] = [];
  if (opts.hasKnowledge) {
    defs.push({
      name: PLATFORM_TOOL_NAMES.searchKnowledge,
      description: "Search the company knowledge you are allowed to read. Use it when the provided knowledge doesn't answer the question.",
      inputSchema: { type: "object", properties: { query: { type: "string", description: "What to look for" } }, required: ["query"], additionalProperties: false },
    });
  }
  defs.push({
    name: PLATFORM_TOOL_NAMES.remember,
    description: "Save a durable fact to your long-term memory (e.g. a customer preference). Never store secrets or personal data beyond what the task needs.",
    inputSchema: { type: "object", properties: { fact: { type: "string", description: "The fact to remember, one sentence" } }, required: ["fact"], additionalProperties: false },
  });
  if (opts.allowQuestions) {
    defs.push({
      name: PLATFORM_TOOL_NAMES.askHuman,
      description: "Ask your human manager a question when required information is missing. Work pauses until they answer.",
      inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"], additionalProperties: false },
    });
    defs.push({
      name: PLATFORM_TOOL_NAMES.escalate,
      description: "Escalate to a human when you can't proceed safely: insufficient evidence, a policy conflict, missing permission, or repeated failures.",
      inputSchema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"], additionalProperties: false },
    });
  }
  if (snapshot.canDelegate && opts.delegates.length) {
    defs.push({
      name: PLATFORM_TOOL_NAMES.delegate,
      description: `Hand a sub-task to a colleague. They work with their own permissions. Colleagues: ${opts.delegates.map((d) => `${d.name} (${d.jobTitle})`).join(", ")}.`,
      inputSchema: {
        type: "object",
        properties: {
          employee: { type: "string", description: "Colleague's name", enum: opts.delegates.map((d) => d.name) },
          task: { type: "string", description: "Clear description of what they should do and return" },
        },
        required: ["employee", "task"],
        additionalProperties: false,
      },
    });
  }
  return defs;
}
