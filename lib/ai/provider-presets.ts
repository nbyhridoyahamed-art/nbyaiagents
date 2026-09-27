import type { ProviderKind } from "@/lib/generated/prisma/enums";

/**
 * Providers that speak the OpenAI Chat Completions API. They share one adapter
 * (lib/ai/providers/openai.ts); these presets supply the endpoint and UI copy.
 * Models are free-form ids listed live from the provider's /models endpoint,
 * because hosted catalogs (especially free tiers) change every few weeks.
 */
export interface OpenAIStylePreset {
  kind: ProviderKind;
  /** Fixed endpoint; null means the organization supplies its own. */
  baseUrl: string | null;
  /** Suggested endpoint shown in the form when the base URL is editable. */
  baseUrlPlaceholder?: string;
  keyRequired: boolean;
  keyPlaceholder: string;
  description: string;
  /** Plain statement of what's free, so nobody is surprised by a bill. */
  freeNote: string;
  signupUrl?: string;
  modelPlaceholder: string;
}

export const OPENAI_STYLE_PRESETS: Partial<Record<ProviderKind, OpenAIStylePreset>> = {
  OPENROUTER: {
    kind: "OPENROUTER",
    baseUrl: "https://openrouter.ai/api/v1",
    keyRequired: true,
    keyPlaceholder: "sk-or-…",
    description: "One key for hundreds of models from many labs, including a rotating set of free models (ids ending in :free).",
    freeNote: "Free models cost nothing but are rate-limited; paid models bill your OpenRouter credits.",
    signupUrl: "https://openrouter.ai/keys",
    modelPlaceholder: "e.g. a model id ending in :free",
  },
  OLLAMA: {
    kind: "OLLAMA",
    baseUrl: null,
    baseUrlPlaceholder: "https://ollama.com/v1 or https://your-ollama-server/v1",
    keyRequired: false,
    keyPlaceholder: "Only needed for Ollama Cloud or a protected server",
    description: "Open models (Llama, Qwen, Gemma, Mistral…) on your own Ollama server, or on Ollama Cloud.",
    freeNote: "Self-hosted Ollama is free — you run the hardware. The server must be reachable from this app over the internet.",
    signupUrl: "https://ollama.com",
    modelPlaceholder: "e.g. llama3.1",
  },
  GROQ: {
    kind: "GROQ",
    baseUrl: "https://api.groq.com/openai/v1",
    keyRequired: true,
    keyPlaceholder: "gsk_…",
    description: "Very fast inference for open models such as Llama and Qwen.",
    freeNote: "Free tier with per-minute and per-day rate limits; no card required.",
    signupUrl: "https://console.groq.com/keys",
    modelPlaceholder: "e.g. llama-3.3-70b-versatile",
  },
  CEREBRAS: {
    kind: "CEREBRAS",
    baseUrl: "https://api.cerebras.ai/v1",
    keyRequired: true,
    keyPlaceholder: "csk-…",
    description: "Extremely fast inference for open models.",
    freeNote: "Free tier with daily token limits.",
    signupUrl: "https://cloud.cerebras.ai",
    modelPlaceholder: "e.g. llama-3.3-70b",
  },
  MISTRAL: {
    kind: "MISTRAL",
    baseUrl: "https://api.mistral.ai/v1",
    keyRequired: true,
    keyPlaceholder: "Mistral API key",
    description: "Mistral's own models (Mistral Small/Medium/Large, Codestral).",
    freeNote: "The free “Experiment” plan allows limited requests for evaluation.",
    signupUrl: "https://console.mistral.ai/api-keys",
    modelPlaceholder: "e.g. mistral-small-latest",
  },
};

/** Providers whose model is a free-form id rather than an entry in the MODELS catalog. */
export const OPEN_MODEL_PROVIDERS: ProviderKind[] = ["OPENAI_COMPATIBLE", "OPENROUTER", "OLLAMA", "GROQ", "CEREBRAS", "MISTRAL"];

export function isOpenModelProvider(kind: ProviderKind): boolean {
  return OPEN_MODEL_PROVIDERS.includes(kind);
}

/** Every provider an organization can configure, in display order. */
export const CONFIGURABLE_PROVIDERS = ["ANTHROPIC", "OPENAI", "GOOGLE", "OPENROUTER", "GROQ", "CEREBRAS", "MISTRAL", "OLLAMA", "OPENAI_COMPATIBLE"] as const satisfies readonly ProviderKind[];
export type ConfigurableProvider = (typeof CONFIGURABLE_PROVIDERS)[number];

/** All provider kinds, for Zod enums shared by agents and workflows. */
export const ALL_PROVIDERS = [...CONFIGURABLE_PROVIDERS, "OFFLINE"] as const satisfies readonly ProviderKind[];
