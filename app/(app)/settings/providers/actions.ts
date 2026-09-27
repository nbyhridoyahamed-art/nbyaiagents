"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireOrgContext } from "@/lib/auth/context";
import { userActor } from "@/lib/auth/actor";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { assertSafeUrl } from "@/lib/security/ssrf";
import { createCredential, revokeCredential } from "@/server/services/credentials";
import { callModel } from "@/lib/ai/router";
import { PROVIDER_LABELS } from "@/lib/ai/models";
import { CONFIGURABLE_PROVIDERS, OPENAI_STYLE_PRESETS, isOpenModelProvider } from "@/lib/ai/provider-presets";
import { KEYLESS_PLACEHOLDER, defaultModelOf, resolveProviderCredentials } from "@/server/services/ai-providers";
import { clearProviderModelCache, listProviderModels, type ProviderModelOption } from "@/server/services/provider-models";
import { writeAudit } from "@/server/services/audit";

const kind = z.enum(CONFIGURABLE_PROVIDERS);
const allowPrivate = () => process.env.ALLOW_PRIVATE_NETWORK_TOOLS === "true";

export async function saveProviderKeyAction(input: { kind: string; apiKey: string; baseUrl?: string; defaultModel?: string }): Promise<ActionResult<{ defaultModel: string | null }>> {
  return runAction(z.object({ kind, apiKey: z.string().trim().max(500), baseUrl: z.string().trim().max(300).optional(), defaultModel: z.string().trim().max(200).optional() }), input, async (data) => {
    const ctx = await requireOrgContext("credentials:manage");
    const preset = OPENAI_STYLE_PRESETS[data.kind];
    const keyRequired = preset ? preset.keyRequired : true;
    if (keyRequired && data.apiKey.length < 8) throw new AppError("VALIDATION", "Paste the full API key.", { fieldErrors: { apiKey: "Paste the full API key." } });
    const needsBaseUrl = data.kind === "OPENAI_COMPATIBLE" || data.kind === "OLLAMA";
    if (needsBaseUrl) {
      if (!data.baseUrl) throw new AppError("VALIDATION", `Enter the base URL of the ${PROVIDER_LABELS[data.kind]} server.`, { fieldErrors: { baseUrl: "Required." } });
      try {
        assertSafeUrl(data.baseUrl, allowPrivate());
      } catch {
        throw new AppError("VALIDATION", "That URL isn't reachable from this app. Use a public https address (private and localhost addresses are blocked).", {
          fieldErrors: { baseUrl: "Use a public https URL." },
        });
      }
    }
    if (data.kind === "OPENAI_COMPATIBLE" && !data.defaultModel) throw new AppError("VALIDATION", "Enter the model name to use.", { fieldErrors: { defaultModel: "Required." } });

    const actor = userActor(ctx.org.id, ctx.user.id);
    const cred = await createCredential(actor, { name: `${data.kind} API key`, type: "API_KEY", secret: data.apiKey || KEYLESS_PLACEHOLDER });
    const existing = await prisma.aiProvider.findFirst({ where: { orgId: ctx.org.id, kind: data.kind } });
    if (existing?.credentialId) await revokeCredential(actor, existing.credentialId);
    // Keep the previously chosen model when only the key is being replaced.
    const keptModel = data.defaultModel || existing?.defaultModel || null;
    const baseUrl = needsBaseUrl ? data.baseUrl! : null;
    await prisma.aiProvider.upsert({
      where: { orgId_kind_name: { orgId: ctx.org.id, kind: data.kind, name: data.kind } },
      create: { orgId: ctx.org.id, kind: data.kind, name: data.kind, credentialId: cred.id, baseUrl, defaultModel: keptModel },
      update: { credentialId: cred.id, baseUrl, defaultModel: keptModel, enabled: true },
    });
    clearProviderModelCache(ctx.org.id, data.kind);

    // Free-form providers need a model; pick a sensible one (free and tool-capable first) if none was given.
    let defaultModel = keptModel;
    if (!defaultModel && isOpenModelProvider(data.kind)) {
      const models = await listProviderModels(ctx.org.id, data.kind).catch(() => [] as ProviderModelOption[]);
      const pick = models.find((m) => m.free && m.tools) ?? models.find((m) => m.tools) ?? models[0];
      if (pick) {
        defaultModel = pick.id;
        await prisma.aiProvider.update({ where: { orgId_kind_name: { orgId: ctx.org.id, kind: data.kind, name: data.kind } }, data: { defaultModel } });
      }
    }
    await writeAudit({ orgId: ctx.org.id, actorType: "USER", actorUserId: ctx.user.id, action: "ai_provider.configure", metadata: { kind: data.kind, defaultModel } });
    revalidatePath("/settings/providers");
    return { defaultModel };
  });
}

/** Changes the default model of a connected free-form provider without re-entering its key. */
export async function setProviderModelAction(input: { kind: string; model: string }): Promise<ActionResult> {
  return runAction(z.object({ kind, model: z.string().trim().min(1, "Choose a model.").max(200) }), input, async (data) => {
    const ctx = await requireOrgContext("credentials:manage");
    if (!isOpenModelProvider(data.kind)) throw new AppError("VALIDATION", "This provider uses the built-in model list.");
    const p = await prisma.aiProvider.findFirst({ where: { orgId: ctx.org.id, kind: data.kind } });
    if (!p) throw new AppError("NOT_CONFIGURED", `Connect ${PROVIDER_LABELS[data.kind]} first.`);
    await prisma.aiProvider.update({ where: { id: p.id }, data: { defaultModel: data.model } });
    await writeAudit({ orgId: ctx.org.id, actorType: "USER", actorUserId: ctx.user.id, action: "ai_provider.configure", metadata: { kind: data.kind, defaultModel: data.model } });
    revalidatePath("/settings/providers");
  });
}

/** Live model list for a free-form provider (used by the settings page and the employee model pickers). */
export async function listProviderModelsAction(k: string): Promise<ActionResult<ProviderModelOption[]>> {
  return runAction(kind, k, async (providerKind) => {
    const ctx = await requireOrgContext();
    await enforceRateLimit("toolTest", ctx.org.id);
    return listProviderModels(ctx.org.id, providerKind);
  });
}

export async function removeProviderKeyAction(k: string): Promise<ActionResult> {
  return runAction(kind, k, async (providerKind) => {
    const ctx = await requireOrgContext("credentials:manage");
    const p = await prisma.aiProvider.findFirst({ where: { orgId: ctx.org.id, kind: providerKind } });
    if (!p) return;
    if (p.credentialId) await revokeCredential(userActor(ctx.org.id, ctx.user.id), p.credentialId);
    await prisma.aiProvider.delete({ where: { id: p.id } });
    clearProviderModelCache(ctx.org.id, providerKind);
    revalidatePath("/settings/providers");
  });
}

/** Sends a tiny request to verify the key works (a real call of a few tokens; billable on paid models). */
export async function testProviderAction(k: string): Promise<ActionResult<{ model: string; latencyMs: number }>> {
  return runAction(kind, k, async (providerKind) => {
    const ctx = await requireOrgContext("credentials:manage");
    await enforceRateLimit("toolTest", ctx.org.id);
    const creds = await resolveProviderCredentials(ctx.org.id, providerKind);
    const model = defaultModelOf({ kind: providerKind, defaultModel: creds.defaultModel ?? null });
    if (!model) throw new AppError("VALIDATION", `Choose a default ${PROVIDER_LABELS[providerKind]} model first.`);
    const started = Date.now();
    try {
      const res = await callModel(
        ctx.org.id,
        { provider: providerKind, model, fallbackProvider: null, fallbackModel: null, temperature: 0, maxOutputTokens: 16 },
        { system: "Reply with the single word: ok", messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }] },
      );
      return { model: res.model, latencyMs: Date.now() - started };
    } catch (err) {
      throw new AppError("INTEGRATION_ERROR", `The provider rejected the test: ${String((err as Error).message).slice(0, 200)}`);
    }
  });
}
