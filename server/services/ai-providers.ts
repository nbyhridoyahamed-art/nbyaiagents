import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import type { ProviderKind } from "@/lib/generated/prisma/enums";
import { decryptSecret } from "@/lib/security/crypto";
import { DEFAULT_MODEL_BY_PROVIDER } from "@/lib/ai/models";

export interface ProviderCredentials {
  kind: ProviderKind;
  apiKey?: string;
  baseUrl?: string;
  source: "organization" | "platform" | "none";
}

const PLATFORM_KEYS: Record<Exclude<ProviderKind, "OFFLINE">, () => { apiKey?: string; baseUrl?: string }> = {
  ANTHROPIC: () => ({ apiKey: env().ANTHROPIC_API_KEY || undefined }),
  OPENAI: () => ({ apiKey: env().OPENAI_API_KEY || undefined }),
  GOOGLE: () => ({ apiKey: env().GOOGLE_API_KEY || undefined }),
  OPENAI_COMPATIBLE: () => ({
    apiKey: env().OPENAI_COMPATIBLE_API_KEY || undefined,
    baseUrl: env().OPENAI_COMPATIBLE_BASE_URL || undefined,
  }),
};

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
      baseUrl: orgProvider.baseUrl ?? undefined,
      source: "organization",
    };
  }
  const platform = PLATFORM_KEYS[kind]();
  if (platform.apiKey && (kind !== "OPENAI_COMPATIBLE" || platform.baseUrl)) {
    return { kind, ...platform, source: "platform" };
  }
  return { kind, source: "none" };
}

export interface ProviderStatus {
  kind: ProviderKind;
  configured: boolean;
  source: ProviderCredentials["source"];
}

export async function listProviderStatus(orgId: string): Promise<ProviderStatus[]> {
  const kinds: ProviderKind[] = ["ANTHROPIC", "OPENAI", "GOOGLE", "OPENAI_COMPATIBLE"];
  const statuses = await Promise.all(
    kinds.map(async (kind) => {
      const creds = await resolveProviderCredentials(orgId, kind);
      return { kind, configured: creds.source !== "none", source: creds.source };
    }),
  );
  return [...statuses, { kind: "OFFLINE", configured: true, source: "none" }];
}

/** Best available provider/model for a new agent. Falls back to the offline demo model. */
export async function defaultModelFor(orgId: string): Promise<{ provider: ProviderKind; model: string }> {
  for (const status of await listProviderStatus(orgId)) {
    if (status.configured && status.kind !== "OFFLINE") {
      return { provider: status.kind, model: DEFAULT_MODEL_BY_PROVIDER[status.kind] };
    }
  }
  return { provider: "OFFLINE", model: "offline-demo" };
}
