import { AppError } from "@/lib/errors";
import type { ProviderKind } from "@/lib/generated/prisma/enums";
import { PROVIDER_LABELS } from "@/lib/ai/models";
import { isOpenModelProvider } from "@/lib/ai/provider-presets";
import { safeHttpRequest } from "@/lib/security/ssrf";
import { resolveProviderCredentials } from "@/server/services/ai-providers";

export interface ProviderModelOption {
  id: string;
  label: string;
  /** Known to cost nothing per token (OpenRouter reports pricing; others don't). */
  free: boolean;
  /** true/false when the provider reports tool-calling support, null when unknown. */
  tools: boolean | null;
}

interface RawModel {
  id?: string;
  name?: string;
  active?: boolean;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  capabilities?: { function_calling?: boolean; completion_chat?: boolean };
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; models: ProviderModelOption[] }>();

function toOption(kind: ProviderKind, m: RawModel): ProviderModelOption | null {
  if (!m.id || m.active === false) return null;
  if (kind === "MISTRAL" && m.capabilities?.completion_chat === false) return null;
  const free = kind === "OPENROUTER" ? Number(m.pricing?.prompt ?? 1) === 0 && Number(m.pricing?.completion ?? 1) === 0 : kind === "OLLAMA";
  const tools = m.supported_parameters ? m.supported_parameters.includes("tools") : typeof m.capabilities?.function_calling === "boolean" ? m.capabilities.function_calling : null;
  return { id: m.id, label: m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id, free, tools };
}

/**
 * Lists the models an organization can use with a free-form provider, straight
 * from the provider's OpenAI-style GET /models. Cached briefly per org.
 */
export async function listProviderModels(orgId: string, kind: ProviderKind): Promise<ProviderModelOption[]> {
  if (!isOpenModelProvider(kind)) throw new AppError("VALIDATION", "This provider uses the built-in model list.");
  const key = `${orgId}:${kind}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.models;

  const creds = await resolveProviderCredentials(orgId, kind);
  if (creds.source === "none" || !creds.baseUrl) throw new AppError("NOT_CONFIGURED", `Connect ${PROVIDER_LABELS[kind]} first.`);
  const res = await safeHttpRequest({
    method: "GET",
    url: `${creds.baseUrl.replace(/\/+$/, "")}/models`,
    headers: { accept: "application/json", ...(creds.apiKey ? { authorization: `Bearer ${creds.apiKey}` } : {}) },
    timeoutMs: 15_000,
    maxBytes: 8 * 1024 * 1024,
    allowPrivate: (kind === "OLLAMA" || kind === "OPENAI_COMPATIBLE") && process.env.ALLOW_PRIVATE_NETWORK_TOOLS === "true",
  });
  if (res.status === 401 || res.status === 403) throw new AppError("INTEGRATION_ERROR", `${PROVIDER_LABELS[kind]} rejected the key (HTTP ${res.status}).`);
  if (res.status >= 400) throw new AppError("INTEGRATION_ERROR", `${PROVIDER_LABELS[kind]} couldn't list models (HTTP ${res.status}).`);
  let raw: RawModel[] = [];
  try {
    const body = JSON.parse(res.body) as { data?: RawModel[]; models?: RawModel[] };
    raw = body.data ?? body.models ?? [];
  } catch {
    throw new AppError("INTEGRATION_ERROR", `${PROVIDER_LABELS[kind]} returned a model list this app couldn't read.`);
  }
  const models = raw
    .map((m) => toOption(kind, m))
    .filter((m): m is ProviderModelOption => !!m)
    // Free first, then tool-capable, then alphabetical.
    .sort((a, b) => Number(b.free) - Number(a.free) || Number(b.tools === true) - Number(a.tools === true) || a.id.localeCompare(b.id))
    .slice(0, 400);
  cache.set(key, { at: Date.now(), models });
  return models;
}

/** Forget cached lists after a provider's key or endpoint changes. */
export function clearProviderModelCache(orgId: string, kind: ProviderKind) {
  cache.delete(`${orgId}:${kind}`);
}
