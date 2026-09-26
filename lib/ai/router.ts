import { AppError } from "@/lib/errors";
import { assertResolvesPublic } from "@/lib/security/ssrf";
import type { ProviderKind } from "@/lib/generated/prisma/enums";
import { resolveProviderCredentials } from "@/server/services/ai-providers";
import { createAnthropicProvider } from "@/lib/ai/providers/anthropic";
import { createOpenAIProvider } from "@/lib/ai/providers/openai";
import { createGoogleProvider } from "@/lib/ai/providers/google";
import { createOfflineProvider } from "@/lib/ai/providers/offline";
import { RetryableProviderError, type AIProvider, type GenerateRequest, type GenerateResponse } from "@/lib/ai/types";

export interface ModelConfig {
  provider: ProviderKind;
  model: string;
  fallbackProvider: ProviderKind | null;
  fallbackModel: string | null;
  temperature: number;
  maxOutputTokens: number;
}

type ProviderFactory = (orgId: string, kind: ProviderKind) => Promise<AIProvider>;

async function defaultFactory(orgId: string, kind: ProviderKind): Promise<AIProvider> {
  if (kind === "OFFLINE") return createOfflineProvider();
  const creds = await resolveProviderCredentials(orgId, kind);
  if (!creds.apiKey) {
    throw new AppError("NOT_CONFIGURED", `No API key is configured for ${kind.toLowerCase().replace("_", "-")}. Add one in Settings → AI providers.`);
  }
  switch (kind) {
    case "ANTHROPIC":
      return createAnthropicProvider(creds.apiKey);
    case "OPENAI":
      return createOpenAIProvider(creds.apiKey);
    case "OPENAI_COMPATIBLE":
      if (!creds.baseUrl) throw new AppError("NOT_CONFIGURED", "The OpenAI-compatible provider needs a base URL.");
      // Org-supplied endpoint: re-check where it resolves every time (SSRF / DNS rebinding).
      await assertResolvesPublic(creds.baseUrl, process.env.ALLOW_PRIVATE_NETWORK_TOOLS === "true");
      return createOpenAIProvider(creds.apiKey, { baseURL: creds.baseUrl, kind: "OPENAI_COMPATIBLE" });
    case "GOOGLE":
      return createGoogleProvider(creds.apiKey);
  }
}

let factory: ProviderFactory = defaultFactory;

/** Test hook: substitute a scripted provider. */
export function setProviderFactory(f: ProviderFactory | null) {
  factory = f ?? defaultFactory;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function attempt(orgId: string, kind: ProviderKind, model: string, cfg: ModelConfig, req: Omit<GenerateRequest, "model" | "maxOutputTokens" | "temperature">) {
  const provider = await factory(orgId, kind);
  let lastErr: unknown;
  for (let i = 0; i < 2; i++) {
    try {
      return await provider.generate({ ...req, model, maxOutputTokens: cfg.maxOutputTokens, temperature: cfg.temperature });
    } catch (err) {
      lastErr = err;
      if (!(err instanceof RetryableProviderError) || req.signal?.aborted) throw err;
      await sleep(1000 * (i + 1) * 2);
    }
  }
  throw lastErr;
}

/**
 * Calls the configured model, retrying transient failures, then the fallback
 * model if one is configured. Returns which model actually answered.
 */
export async function callModel(
  orgId: string,
  cfg: ModelConfig,
  req: Omit<GenerateRequest, "model" | "maxOutputTokens" | "temperature">,
): Promise<GenerateResponse & { usedFallback: boolean }> {
  try {
    return { ...(await attempt(orgId, cfg.provider, cfg.model, cfg, req)), usedFallback: false };
  } catch (primaryErr) {
    if (!cfg.fallbackProvider || !cfg.fallbackModel || req.signal?.aborted) throw primaryErr;
    // Provider-specific replay data can't cross providers; neutral content is kept.
    const messages = req.messages.map((m) => (m.providerData?.provider === cfg.fallbackProvider ? m : { ...m, providerData: undefined }));
    const res = await attempt(orgId, cfg.fallbackProvider, cfg.fallbackModel, cfg, { ...req, messages });
    return { ...res, usedFallback: true };
  }
}
