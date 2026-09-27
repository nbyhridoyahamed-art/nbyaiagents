import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import type { ProviderKind } from "@/lib/generated/prisma/enums";
import { decryptSecret } from "@/lib/security/crypto";
import { DEFAULT_MODEL_BY_PROVIDER } from "@/lib/ai/models";
import { CONFIGURABLE_PROVIDERS, OPENAI_STYLE_PRESETS, isOpenModelProvider } from "@/lib/ai/provider-presets";

export interface ProviderCredentials {
  kind: ProviderKind;
  apiKey?: string;
  baseUrl?: string;
  /** The model picked when the provider was connected (free-form providers). */
  defaultModel?: string;
  source: "organization" | "platform" | "none";
}

/** Keyless providers (a self-hosted Ollama) still need a non-empty key for the OpenAI SDK. */
export const KEYLESS_PLACEHOLDER = "no-key";

const PLATFORM_KEYS: Record<Exclude<ProviderKind, "OFFLINE">, () => { apiKey?: string; baseUrl?: string; defaultModel?: string }> = {
  ANTHROPIC: () => ({ apiKey: env().ANTHROPIC_API_KEY || undefined }),
  OPENAI: () => ({ apiKey: env().OPENAI_API_KEY || undefined }),
  GOOGLE: () => ({ apiKey: env().GOOGLE_API_KEY || undefined }),
  OPENAI_COMPATIBLE: () => ({
    apiKey: env().OPENAI_COMPATIBLE_API_KEY || undefined,
    baseUrl: env().OPENAI_COMPATIBLE_BASE_URL || undefined,
    defaultModel: env().OPENAI_COMPATIBLE_MODEL || undefined,
  }),
  OPENROUTER: () => ({ apiKey: env().OPENROUTER_API_KEY || undefined, defaultModel: env().OPENROUTER_MODEL || undefined }),
  GROQ: () => ({ apiKey: env().GROQ_API_KEY || undefined, defaultModel: env().GROQ_MODEL || undefined }),
  CEREBRAS: () => ({ apiKey: env().CEREBRAS_API_KEY || undefined, defaultModel: env().CEREBRAS_MODEL || undefined }),
  MISTRAL: () => ({ apiKey: env().MISTRAL_API_KEY || undefined, defaultModel: env().MISTRAL_MODEL || undefined }),
  OLLAMA: () => (env().OLLAMA_BASE_URL ? { apiKey: env().OLLAMA_API_KEY || KEYLESS_PLACEHOLDER, baseUrl: env().OLLAMA_BASE_URL, defaultModel: env().OLLAMA_MODEL || undefined } : {}),
};

/** The endpoint to call: the preset's fixed URL, else the one the organization (or platform) supplied. */
function endpointFor(kind: ProviderKind, configured?: string | null): string | undefined {
  return OPENAI_STYLE_PRESETS[kind]?.baseUrl ?? configured ?? undefined;
}

/**
 * Resolves credentials for a provider: an org-level key (encrypted in the DB)
 * wins over a platform-level env key. Never returned to the browser.
 */
export async function resolveProviderCredentials(orgId: string, kind: ProviderKind): Promise<ProviderCredentials> {
  if (kind === "OFFLINE") return { kind, source: "none" };
  const orgProvider = await prisma.aiProvider.findFirst({
    where: { orgId, kind, enabled: true, credential: { revokedAt: null } },
    include: { credential: true },
    orderBy: { createdAt: "asc" },
  });
  if (orgProvider?.credential) {
    return {
      kind,
      apiKey: decryptSecret(orgProvider.credential.ciphertext),
      baseUrl: endpointFor(kind, orgProvider.baseUrl),
      defaultModel: orgProvider.defaultModel ?? undefined,
      source: "organization",
    };
  }
  const platform = PLATFORM_KEYS[kind]();
  const baseUrl = endpointFor(kind, platform.baseUrl);
  const needsBaseUrl = kind === "OPENAI_COMPATIBLE" || kind === "OLLAMA";
  if (platform.apiKey && (!needsBaseUrl || baseUrl)) {
    return { kind, apiKey: platform.apiKey, baseUrl, defaultModel: platform.defaultModel, source: "platform" };
  }
  return { kind, source: "none" };
}

export interface ProviderStatus {
  kind: ProviderKind;
  configured: boolean;
  source: ProviderCredentials["source"];
  defaultModel: string | null;
}

export async function listProviderStatus(orgId: string): Promise<ProviderStatus[]> {
  const statuses = await Promise.all(
    CONFIGURABLE_PROVIDERS.map(async (kind) => {
      const creds = await resolveProviderCredentials(orgId, kind);
      return { kind, configured: creds.source !== "none", source: creds.source, defaultModel: creds.defaultModel ?? null };
    }),
  );
  return [...statuses, { kind: "OFFLINE", configured: true, source: "none", defaultModel: "offline-demo" }];
}

/** The model to use for a provider when none was chosen explicitly. */
export function defaultModelOf(status: Pick<ProviderStatus, "kind" | "defaultModel">): string {
  return (isOpenModelProvider(status.kind) ? status.defaultModel : null) || DEFAULT_MODEL_BY_PROVIDER[status.kind];
}

/** Best available provider/model for a new agent. Falls back to the offline demo model. */
export async function defaultModelFor(orgId: string): Promise<{ provider: ProviderKind; model: string }> {
  for (const status of await listProviderStatus(orgId)) {
    if (!status.configured || status.kind === "OFFLINE") continue;
    const model = defaultModelOf(status);
    // A free-form provider without a chosen model can't be used as a default.
    if (model) return { provider: status.kind, model };
  }
  return { provider: "OFFLINE", model: "offline-demo" };
}
