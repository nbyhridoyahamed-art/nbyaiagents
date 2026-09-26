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
      const text = m.content.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : "")).join("\n");
      if (text) out.push({ role: "user", content: text });
    } else {
      const text = m.content.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : "")).join("\n");
      const calls = m.content.filter((p) => p.type === "tool_call");
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((c) =>
                c.type === "tool_call" ? { id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.input) } } : (undefined as never),
              ),
            }
          : {}),
      });
    }
  }
  return out;
}

export function createOpenAIProvider(apiKey: string, opts: { baseURL?: string; kind?: ProviderKind } = {}): AIProvider {
  const client = new OpenAI({ apiKey, baseURL: opts.baseURL, maxRetries: 2, timeout: 5 * 60 * 1000 });
  const kind = opts.kind ?? "OPENAI";
  return {
    kind,
    async generate(req: GenerateRequest): Promise<GenerateResponse> {
      let res: OpenAI.Chat.Completions.ChatCompletion;
      try {
        res = await client.chat.completions.create(
          {
            model: req.model,
            messages: toOpenAIMessages(req.system, req.messages),
            max_completion_tokens: req.maxOutputTokens,
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
            ...(req.tools?.length
              ? { tools: req.tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }
              : {}),
            ...(req.responseSchema
              ? { response_format: { type: "json_schema" as const, json_schema: { name: req.responseSchema.name, schema: req.responseSchema.schema, strict: false } } }
              : {}),
          },
          { signal: req.signal },
        );
      } catch (err) {
        if (err instanceof OpenAI.RateLimitError || err instanceof OpenAI.InternalServerError || err instanceof OpenAI.APIConnectionError) {
          throw new RetryableProviderError(`${kind} temporarily unavailable: ${err.message}`, err);
        }
        if (err instanceof OpenAI.APIError) throw new ProviderError(`${kind} rejected the request (${err.status}): ${err.message}`, err.status);
        throw err;
      }
      const choice = res.choices[0];
      const content: ContentPart[] = [];
      if (choice?.message?.content) content.push({ type: "text", text: choice.message.content });
      for (const call of choice?.message?.tool_calls ?? []) {
        if (call.type !== "function") continue;
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(call.function.arguments || "{}");
        } catch {
          input = { __invalid_json: call.function.arguments };
        }
        content.push({ type: "tool_call", id: call.id, name: call.function.name, input });
      }
      const finish = choice?.finish_reason;
      return {
        content,
        stopReason: finish === "tool_calls" ? "tool_use" : finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : "end",
        usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
        model: res.model,
        provider: kind,
      };
    },
  };
}
