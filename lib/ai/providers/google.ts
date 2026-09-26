import { GoogleGenAI, type Content, type Part } from "@google/genai";
import type { AIMessage, AIProvider, ContentPart, GenerateRequest, GenerateResponse } from "@/lib/ai/types";
import { ProviderError, RetryableProviderError } from "@/lib/ai/types";

function toContents(messages: AIMessage[]): Content[] {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: m.content.map((p): Part => {
      if (p.type === "text") return { text: p.text || " " };
      if (p.type === "tool_call") return { functionCall: { id: p.id, name: p.name, args: p.input } };
      return { functionResponse: { id: p.toolCallId, name: p.name, response: p.isError ? { error: p.content } : { output: p.content } } };
    }),
  }));
}

export function createGoogleProvider(apiKey: string): AIProvider {
  const client = new GoogleGenAI({ apiKey });
  return {
    kind: "GOOGLE",
    async generate(req: GenerateRequest): Promise<GenerateResponse> {
      let res;
      try {
        res = await client.models.generateContent({
          model: req.model,
          contents: toContents(req.messages),
          config: {
            systemInstruction: req.system,
            maxOutputTokens: req.maxOutputTokens,
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
            ...(req.tools?.length
              ? { tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.inputSchema })) }] }
              : {}),
            ...(req.responseSchema && !req.tools?.length ? { responseMimeType: "application/json", responseJsonSchema: req.responseSchema.schema } : {}),
            abortSignal: req.signal,
          },
        });
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 429 || (status !== undefined && status >= 500) || status === undefined) {
          throw new RetryableProviderError(`Google Gemini temporarily unavailable: ${String((err as Error).message)}`, err);
        }
        throw new ProviderError(`Google Gemini rejected the request (${status}): ${String((err as Error).message)}`, status);
      }
      const content: ContentPart[] = [];
      const parts = res.candidates?.[0]?.content?.parts ?? [];
      let i = 0;
      for (const part of parts) {
        if (part.text && !part.thought) content.push({ type: "text", text: part.text });
        if (part.functionCall?.name) {
          content.push({ type: "tool_call", id: part.functionCall.id ?? `call_${Date.now()}_${i++}`, name: part.functionCall.name, input: (part.functionCall.args ?? {}) as Record<string, unknown> });
        }
      }
      const finish = res.candidates?.[0]?.finishReason;
      const hasCalls = content.some((c) => c.type === "tool_call");
      return {
        content,
        stopReason: hasCalls ? "tool_use" : finish === "MAX_TOKENS" ? "max_tokens" : finish === "SAFETY" || finish === "PROHIBITED_CONTENT" ? "refusal" : "end",
        usage: { inputTokens: res.usageMetadata?.promptTokenCount ?? 0, outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0 },
        model: req.model,
        provider: "GOOGLE",
      };
    },
  };
}
