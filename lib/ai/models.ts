import type { ProviderKind } from "@/lib/generated/prisma/enums";

export interface ModelInfo {
  id: string;
  provider: ProviderKind;
  label: string;
  /** USD per 1M tokens. Used for *estimated* cost only. */
  inputPerMTok: number;
  outputPerMTok: number;
  contextWindow: number;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  /** Anthropic 4.6+ / 5.x models reject sampling parameters (temperature/top_p). */
  supportsTemperature: boolean;
  description: string;
  recommended?: boolean;
}

/**
 * Model catalog. Prices are list prices used to *estimate* cost — invoices from
 * the provider are the source of truth. Update when providers change pricing.
 */
export const MODELS: ModelInfo[] = [
  // Anthropic
  {
    id: "claude-opus-5",
    provider: "ANTHROPIC",
    label: "Claude Opus 5",
    inputPerMTok: 5,
    outputPerMTok: 25,
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsTemperature: false,
    description: "Highly capable model for complex, multi-step agent work.",
    recommended: true,
  },
  {
    id: "claude-sonnet-5",
    provider: "ANTHROPIC",
    label: "Claude Sonnet 5",
    inputPerMTok: 2,
    outputPerMTok: 10,
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsTemperature: false,
    description: "Fast and capable for everyday business tasks.",
  },
  {
    id: "claude-haiku-4-5",
    provider: "ANTHROPIC",
    label: "Claude Haiku 4.5",
    inputPerMTok: 1,
    outputPerMTok: 5,
    contextWindow: 200_000,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsTemperature: true,
    description: "Lowest latency for simple classification and extraction.",
  },
  {
    id: "claude-fable-5-1",
    provider: "ANTHROPIC",
    label: "Claude Fable 5.1",
    inputPerMTok: 10,
    outputPerMTok: 50,
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsTemperature: false,
    description: "Anthropic's most capable model for the hardest long-horizon work.",
  },
  // OpenAI (prices approximate — verify against your OpenAI account)
  {
    id: "gpt-4.1",
    provider: "OPENAI",
    label: "GPT-4.1",
    inputPerMTok: 2,
    outputPerMTok: 8,
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsTemperature: true,
    description: "OpenAI general-purpose model.",
  },
  {
    id: "gpt-4.1-mini",
    provider: "OPENAI",
    label: "GPT-4.1 mini",
    inputPerMTok: 0.4,
    outputPerMTok: 1.6,
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsTemperature: true,
    description: "Smaller, cheaper OpenAI model.",
  },
  // Google
  {
    id: "gemini-2.5-pro",
    provider: "GOOGLE",
    label: "Gemini 2.5 Pro",
    inputPerMTok: 1.25,
    outputPerMTok: 10,
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsTemperature: true,
    description: "Google's capable reasoning model.",
  },
  {
    id: "gemini-2.5-flash",
    provider: "GOOGLE",
    label: "Gemini 2.5 Flash",
    inputPerMTok: 0.3,
    outputPerMTok: 2.5,
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsTemperature: true,
    description: "Fast, low-cost Google model.",
  },
  // Offline (no provider configured)
  {
    id: "offline-demo",
    provider: "OFFLINE",
    label: "Offline demo model",
    inputPerMTok: 0,
    outputPerMTok: 0,
    contextWindow: 200_000,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsTemperature: true,
    description:
      "Deterministic, rule-based stand-in used when no AI provider is configured. It is NOT an AI model: it retrieves knowledge and follows simple rules so you can test the platform end-to-end.",
  },
];

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  ANTHROPIC: "Anthropic",
  OPENAI: "OpenAI",
  GOOGLE: "Google Gemini",
  OPENAI_COMPATIBLE: "OpenAI-compatible",
  OPENROUTER: "OpenRouter",
  OLLAMA: "Ollama",
  GROQ: "Groq",
  CEREBRAS: "Cerebras",
  MISTRAL: "Mistral AI",
  OFFLINE: "Offline demo",
};

export function getModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function modelsFor(provider: ProviderKind): ModelInfo[] {
  return MODELS.filter((m) => m.provider === provider);
}

/**
 * Estimated USD cost for a model call. Models outside the catalog (OpenRouter,
 * Groq, Ollama and other free-form ids) estimate as 0 — check the provider's
 * dashboard for their real cost.
 */
export function estimateCostUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const m = getModel(modelId);
  if (!m) return 0;
  return (inputTokens * m.inputPerMTok + outputTokens * m.outputPerMTok) / 1_000_000;
}

/**
 * Default model per provider. Empty for free-form providers: their model is the
 * one the organization picked when connecting the provider (AiProvider.defaultModel).
 */
export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderKind, string> = {
  ANTHROPIC: "claude-opus-5",
  OPENAI: "gpt-4.1",
  GOOGLE: "gemini-2.5-pro",
  OPENAI_COMPATIBLE: "",
  OPENROUTER: "",
  OLLAMA: "",
  GROQ: "",
  CEREBRAS: "",
  MISTRAL: "",
  OFFLINE: "offline-demo",
};
