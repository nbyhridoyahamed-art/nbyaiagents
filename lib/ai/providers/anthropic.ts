import Anthropic from "@anthropic-ai/sdk";
import type { AIMessage, AIProvider, ContentPart, GenerateRequest, GenerateResponse } from "@/lib/ai/types";
import { ProviderError, RetryableProviderError } from "@/lib/ai/types";
import { getModel } from "@/lib/ai/models";

// Server-side refusal fallback is enabled for these models (routes a policy
// decline to a suitable fallback model inside the same call).
const FALLBACK_MODELS = new Set(["claude-opus-5", "claude-fable-5-1"]);

function toAnthropicMessages(messages: AIMessage[], model: string): Anthropic.Beta.BetaMessageParam[] {
  return messages.map((m) => {
    // Replay the exact assistant content (incl. thinking blocks) to the same model.
    if (m.role === "assistant" && m.providerData?.provider === "ANTHROPIC" && m.providerData.model === model) {
      return { role: "assistant", content: m.providerData.raw as Anthropic.Beta.BetaContentBlockParam[] };
    }
    const content: Anthropic.Beta.BetaContentBlockParam[] = m.content.map((p): Anthropic.Beta.BetaContentBlockParam => {
      if (p.type === "text") return { type: "text", text: p.text || " " };
      if (p.type === "tool_call") return { type: "tool_use", id: p.id, name: p.name, input: p.input };
      return { type: "tool_result", tool_use_id: p.toolCallId, content: p.content, is_error: p.isError ?? false };
    });
    return { role: m.role, content };
  });
}

export function createAnthropicProvider(apiKey: string): AIProvider {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60 * 1000 });
  return {
    kind: "ANTHROPIC",
    async generate(req: GenerateRequest): Promise<GenerateResponse> {
      const info = getModel(req.model);
      const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
        model: req.model,
        max_tokens: req.maxOutputTokens,
        system: req.system,
        messages: toAnthropicMessages(req.messages, req.model),
        ...(req.tools?.length
          ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema })) }
          : {}),
        ...(req.responseSchema ? { output_config: { format: { type: "json_schema" as const, schema: req.responseSchema.schema } } } : {}),
        // Newer Claude models reject sampling parameters.
        ...(info?.supportsTemperature && req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(FALLBACK_MODELS.has(req.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      };
      let res: Anthropic.Beta.BetaMessage;
      try {
        res = await client.beta.messages.create(params, { signal: req.signal });
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
          throw new RetryableProviderError(`Anthropic temporarily unavailable: ${err.message}`, err);
        }
        if (err instanceof Anthropic.APIError) {
          if (err.status === 529 || (err.status ?? 0) >= 500) throw new RetryableProviderError(`Anthropic error ${err.status}`, err);
          throw new ProviderError(`Anthropic rejected the request (${err.status}): ${err.message}`, err.status);
        }
        throw err;
      }

      const content: ContentPart[] = [];
      for (const block of res.content) {
        if (block.type === "text") content.push({ type: "text", text: block.text });
        else if (block.type === "tool_use") content.push({ type: "tool_call", id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
      }
      const stop = res.stop_reason;
      return {
        content,
        stopReason: stop === "tool_use" ? "tool_use" : stop === "max_tokens" ? "max_tokens" : stop === "refusal" ? "refusal" : "end",
        usage: { inputTokens: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0), outputTokens: res.usage.output_tokens },
        model: res.model,
        provider: "ANTHROPIC",
        providerData: res.content,
        refusalCategory: stop === "refusal" ? (res.stop_details?.category ?? null) : undefined,
      };
    },
  };
}
