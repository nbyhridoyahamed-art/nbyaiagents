import OpenAI from "openai";
import type { AIMessage, AIProvider, ContentPart, GenerateRequest, GenerateResponse } from "@/lib/ai/types";
import { ProviderError, RetryableProviderError } from "@/lib/ai/types";
import type { ProviderKind } from "@/lib/generated/prisma/enums";

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function toOpenAIMessages(system: string, messages: AIMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") {
      const results = m.content.filter((p) => p.type === "tool_result");
      for (const r of results) {
        if (r.type === "tool_result") out.push({ role: "tool", tool_call_id: r.toolCallId, content: r.isError ? `ERROR: ${r.content}` : r.content });
      }
      const text = m.content
        .filter((p) => p.type === "text")
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("\n");
      if (text) out.push({ role: "user", content: text });
    } else {
      const text = m.content
        .filter((p) => p.type === "text")
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("\n");
      const calls = m.content.filter((p) => p.type === "tool_call");
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((c) => (c.type === "tool_call" ? { id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.input) } } : (undefined as never))),
            }
          : {}),
      });
    }
  }
  return out;
}

/** Error text that means the endpoint doesn't accept `response_format: json_schema`. */
const SCHEMA_UNSUPPORTED = /response_format|json_schema|structured output|schema/i;
/** Error text that means the chosen model can't call tools. */
const TOOLS_UNSUPPORTED = /tool|function call/i;

function schemaInstruction(schema: NonNullable<GenerateRequest["responseSchema"]>): string {
  return `

Reply with only a JSON object (no prose, no code fences) that matches this JSON Schema:
${JSON.stringify(schema.schema)}`;
}

export function createOpenAIProvider(apiKey: string, opts: { baseURL?: string; kind?: ProviderKind; headers?: Record<string, string> } = {}): AIProvider {
  const client = new OpenAI({ apiKey, baseURL: opts.baseURL, defaultHeaders: opts.headers, maxRetries: 2, timeout: 5 * 60 * 1000 });
  const kind = opts.kind ?? "OPENAI";
  // OpenAI's own API wants max_completion_tokens; compatible servers (OpenRouter, Groq,
  // Mistral, Ollama, vLLM…) reliably accept the older max_tokens.
  const tokenParam = kind === "OPENAI" ? "max_completion_tokens" : "max_tokens";

  async function create(req: GenerateRequest, useSchema: boolean) {
    const system = req.responseSchema && !useSchema ? req.system + schemaInstruction(req.responseSchema) : req.system;
    return client.chat.completions.create(
      {
        model: req.model,
        messages: toOpenAIMessages(system, req.messages),
        [tokenParam]: req.maxOutputTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}),
        ...(req.responseSchema && useSchema
          ? { response_format: { type: "json_schema" as const, json_schema: { name: req.responseSchema.name, schema: req.responseSchema.schema, strict: false } } }
          : {}),
      },
      { signal: req.signal },
    );
  }

  return {
    kind,
    async generate(req: GenerateRequest): Promise<GenerateResponse> {
      let res: OpenAI.Chat.Completions.ChatCompletion;
      try {
        try {
          res = await create(req, true);
        } catch (err) {
          // Many compatible servers/models reject json_schema; ask for JSON in the prompt instead.
          if (kind !== "OPENAI" && req.responseSchema && err instanceof OpenAI.APIError && (err.status === 400 || err.status === 422) && SCHEMA_UNSUPPORTED.test(err.message)) {
            res = await create(req, false);
          } else throw err;
        }
      } catch (err) {
        if (err instanceof OpenAI.RateLimitError || err instanceof OpenAI.InternalServerError || err instanceof OpenAI.APIConnectionError) {
          throw new RetryableProviderError(`${kind} temporarily unavailable: ${err.message}`, err);
        }
        if (err instanceof OpenAI.APIError) {
          if (req.tools?.length && (err.status === 400 || err.status === 404) && TOOLS_UNSUPPORTED.test(err.message)) {
            throw new ProviderError(`The model "${req.model}" can't use tools (${err.message}). Pick a model that supports tool calling, or remove this employee's tools.`, err.status);
          }
          throw new ProviderError(`${kind} rejected the request (${err.status}): ${err.message}`, err.status);
        }
        throw err;
      }
      // Some gateways (e.g. OpenRouter) report upstream failures inside a 200 response.
      const upstreamError = (res as unknown as { error?: { message?: string; code?: number } }).error;
      if (!res.choices?.length) {
        const msg = upstreamError?.message ?? "the provider returned no answer";
        const code = Number(upstreamError?.code ?? 0);
        if (code === 429 || code >= 500 || !upstreamError) throw new RetryableProviderError(`${kind} temporarily unavailable: ${msg}`);
        throw new ProviderError(`${kind} rejected the request (${code}): ${msg}`, code);
      }
      const choice = res.choices[0];
      const content: ContentPart[] = [];
      if (choice?.message?.content) content.push({ type: "text", text: choice.message.content });
      (choice?.message?.tool_calls ?? []).forEach((call, i) => {
        if (call.type !== "function") return;
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(call.function.arguments || "{}");
        } catch {
          input = { __invalid_json: call.function.arguments };
        }
        // Not every server assigns ids; results are matched to calls by id.
        content.push({ type: "tool_call", id: call.id || `call_${Date.now().toString(36)}_${i}`, name: call.function.name, input });
      });
      const finish = choice?.finish_reason;
      const hasCalls = content.some((p) => p.type === "tool_call");
      return {
        content,
        stopReason: finish === "tool_calls" || (hasCalls && finish !== "length") ? "tool_use" : finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : "end",
        usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
        model: res.model || req.model,
        provider: kind,
      };
    },
  };
}
