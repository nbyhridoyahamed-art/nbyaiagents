import type { ProviderKind } from "@/lib/generated/prisma/enums";

/**
 * Provider-neutral model interface. Provider-specific code lives only in
 * lib/ai/providers/*; the runtime, workflows and UI speak these types.
 */

export type JsonSchema = Record<string, unknown>;

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolCallId: string; name: string; content: string; isError?: boolean };

export interface AIMessage {
  role: "user" | "assistant";
  content: ContentPart[];
  /**
   * The provider's raw assistant content (e.g. Anthropic thinking blocks) so a
   * turn can be replayed verbatim to the same provider/model in tool loops.
   */
  providerData?: { provider: ProviderKind; model: string; raw: unknown };
}

export interface AIToolDefinition {
  /** Provider-safe name: [a-zA-Z0-9_-], max 64 chars. */
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface KnowledgeHint {
  source: string;
  documentId: string;
  page: number | null;
  content: string;
}

export interface GenerateRequest {
  model: string;
  system: string;
  messages: AIMessage[];
  tools?: AIToolDefinition[];
  maxOutputTokens: number;
  temperature?: number;
  /** Ask for a JSON object matching this schema (structured output). */
  responseSchema?: { name: string; schema: JsonSchema };
  signal?: AbortSignal;
  /**
   * Structured context for the offline demo model only (real models read the
   * same information from the system prompt).
   */
  offlineHints?: { knowledge: KnowledgeHint[]; agentName: string; taskText: string };
}

export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal";

export interface GenerateResponse {
  content: ContentPart[];
  stopReason: StopReason;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  provider: ProviderKind;
  providerData?: unknown;
  refusalCategory?: string | null;
}

export interface AIProvider {
  kind: ProviderKind;
  generate(req: GenerateRequest): Promise<GenerateResponse>;
}

/** Errors worth retrying (rate limits, overload, network, 5xx). */
export class RetryableProviderError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RetryableProviderError";
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function textOf(parts: ContentPart[]): string {
  return parts
    .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

export function toolCallsOf(parts: ContentPart[]) {
  return parts.filter((p): p is Extract<ContentPart, { type: "tool_call" }> => p.type === "tool_call");
}

/** Converts a tool key like "mock_crm.search_contacts" into a provider-safe function name. */
export function toFunctionName(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "__").slice(0, 64);
}
