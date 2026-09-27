import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { callModel, setProviderFactory } from "@/lib/ai/router";
import { createOpenAIProvider } from "@/lib/ai/providers/openai";
import { ProviderError, RetryableProviderError, toolCallsOf, textOf } from "@/lib/ai/types";
import { createCredential } from "@/server/services/credentials";
import { defaultModelFor, resolveProviderCredentials } from "@/server/services/ai-providers";
import { listProviderModels } from "@/server/services/provider-models";
import { createFixtureOrg, resetDb } from "./helpers";

/**
 * A fake OpenAI-compatible server (what OpenRouter, Groq, Cerebras, Mistral and
 * Ollama expose). Each test queues how it should answer.
 */
type Reply = (body: Record<string, unknown>) => { status: number; json: unknown };
const received: { path: string; auth?: string; body: Record<string, unknown> }[] = [];
let replies: Reply[] = [];
let server: http.Server;
let baseUrl = "";

const ok = (message: Record<string, unknown>, finish = "stop") => ({
  status: 200,
  json: { id: "x", object: "chat.completion", model: "served-model", choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finish }], usage: { prompt_tokens: 12, completion_tokens: 3 } },
});

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      received.push({ path: req.url ?? "", auth: req.headers.authorization, body });
      if (req.method === "GET" && req.url?.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [{ id: "qwen3:8b" }, { id: "llama3.1" }] }));
        return;
      }
      const next = replies.shift() ?? (() => ok({ content: "ok" }));
      const { status, json } = next(body);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => {
  received.length = 0;
  replies = [];
  await resetDb();
});
afterEach(() => {
  setProviderFactory(null);
  delete process.env.ALLOW_PRIVATE_NETWORK_TOOLS;
});

const base = { system: "You are helpful.", messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }], maxOutputTokens: 100, temperature: 0 };

describe("OpenAI-compatible adapter for free providers", () => {
  it("sends max_tokens (not max_completion_tokens) and falls back to prompt-level JSON when json_schema is rejected", async () => {
    replies = [() => ({ status: 400, json: { error: { message: "response_format json_schema is not supported by this model" } } }), () => ok({ content: '{"answer":"yes"}' })];
    const provider = createOpenAIProvider("gsk_test", { baseURL: baseUrl, kind: "GROQ" });
    const res = await provider.generate({ ...base, model: "llama-3.3-70b-versatile", responseSchema: { name: "result", schema: { type: "object", properties: { answer: { type: "string" } } } } });

    expect(received).toHaveLength(2);
    expect(received[0].body.max_tokens).toBe(100);
    expect(received[0].body.max_completion_tokens).toBeUndefined();
    expect(received[0].body.response_format).toBeDefined();
    expect(received[1].body.response_format).toBeUndefined();
    const system = (received[1].body.messages as { role: string; content: string }[])[0];
    expect(system.content).toContain("Reply with only a JSON object");
    expect(textOf(res.content)).toBe('{"answer":"yes"}');
    expect(res.provider).toBe("GROQ");
  });

  it("keeps max_completion_tokens for OpenAI itself", async () => {
    const provider = createOpenAIProvider("sk-test", { baseURL: baseUrl, kind: "OPENAI" });
    await provider.generate({ ...base, model: "gpt-4.1" });
    expect(received[0].body.max_completion_tokens).toBe(100);
    expect(received[0].body.max_tokens).toBeUndefined();
  });

  it("assigns ids to tool calls that arrive without one", async () => {
    replies = [() => ok({ content: null, tool_calls: [{ id: "", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } }] }, "tool_calls")];
    const provider = createOpenAIProvider("no-key", { baseURL: baseUrl, kind: "OLLAMA" });
    const res = await provider.generate({ ...base, model: "llama3.1", tools: [{ name: "lookup", description: "Look up", inputSchema: { type: "object" } }] });
    const [c] = toolCallsOf(res.content);
    expect(c.id).toMatch(/^call_/);
    expect(c.input).toEqual({ q: "x" });
    expect(res.stopReason).toBe("tool_use");
  });

  it("explains when the chosen model can't use tools", async () => {
    replies = [() => ({ status: 404, json: { error: { message: "No endpoints found that support tool use." } } })];
    const provider = createOpenAIProvider("sk-or-test", { baseURL: baseUrl, kind: "OPENROUTER" });
    const err = await provider.generate({ ...base, model: "some/model:free", tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }] }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(String(err.message)).toMatch(/can't use tools/);
  });

  it("treats gateway errors inside a 200 response as failures (rate limits are retryable)", async () => {
    replies = [() => ({ status: 200, json: { error: { message: "Rate limit exceeded: free-models-per-day", code: 429 } } })];
    const provider = createOpenAIProvider("sk-or-test", { baseURL: baseUrl, kind: "OPENROUTER" });
    await expect(provider.generate({ ...base, model: "x:free" })).rejects.toBeInstanceOf(RetryableProviderError);

    replies = [() => ({ status: 200, json: { error: { message: "Model not found", code: 400 } } })];
    await expect(provider.generate({ ...base, model: "x:free" })).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("Ollama connected by an organization", () => {
  async function connectOllama() {
    const { org, actor } = await createFixtureOrg("Ollama Co");
    const cred = await createCredential(actor, { name: "OLLAMA API key", type: "API_KEY", secret: "no-key" });
    await prisma.aiProvider.create({ data: { orgId: org.id, kind: "OLLAMA", name: "OLLAMA", credentialId: cred.id, baseUrl, defaultModel: "llama3.1" } });
    return org;
  }

  it("resolves the org's server, lists its models and becomes the default for new employees", async () => {
    const org = await connectOllama();
    const creds = await resolveProviderCredentials(org.id, "OLLAMA");
    expect(creds).toMatchObject({ source: "organization", baseUrl, defaultModel: "llama3.1" });

    process.env.ALLOW_PRIVATE_NETWORK_TOOLS = "true"; // the fake server is on localhost
    const models = await listProviderModels(org.id, "OLLAMA");
    expect(models.map((m) => m.id)).toEqual(["llama3.1", "qwen3:8b"]);
    expect(models.every((m) => m.free)).toBe(true);

    expect(await defaultModelFor(org.id)).toEqual({ provider: "OLLAMA", model: "llama3.1" });
  });

  it("routes a real call to the org's Ollama server", async () => {
    const org = await connectOllama();
    process.env.ALLOW_PRIVATE_NETWORK_TOOLS = "true";
    replies = [() => ok({ content: "Hello from Ollama" })];
    const res = await callModel(org.id, { provider: "OLLAMA", model: "llama3.1", fallbackProvider: null, fallbackModel: null, temperature: 0.2, maxOutputTokens: 50 }, { system: "s", messages: base.messages });
    expect(textOf(res.content)).toBe("Hello from Ollama");
    const chat = received.find((r) => r.path.endsWith("/chat/completions"))!;
    expect(chat.body.model).toBe("llama3.1");
  });

  it("refuses a private Ollama address unless private networking is explicitly allowed", async () => {
    const org = await connectOllama();
    await expect(
      callModel(org.id, { provider: "OLLAMA", model: "llama3.1", fallbackProvider: null, fallbackModel: null, temperature: 0, maxOutputTokens: 10 }, { system: "s", messages: base.messages }),
    ).rejects.toThrow();
    expect(received.filter((r) => r.path.endsWith("/chat/completions"))).toHaveLength(0);
  });

  it("asks for a model when a free-form provider has none selected", async () => {
    const org = await connectOllama();
    await expect(
      callModel(org.id, { provider: "OLLAMA", model: " ", fallbackProvider: null, fallbackModel: null, temperature: 0, maxOutputTokens: 10 }, { system: "s", messages: base.messages }),
    ).rejects.toThrow(/No Ollama model is selected/);
  });
});
