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
import { DEFAULT_MODEL_BY_PROVIDER } from "@/lib/ai/models";
import { writeAudit } from "@/server/services/audit";

const kind = z.enum(["ANTHROPIC", "OPENAI", "GOOGLE", "OPENAI_COMPATIBLE"]);

export async function saveProviderKeyAction(input: { kind: string; apiKey: string; baseUrl?: string; defaultModel?: string }): Promise<ActionResult> {
  return runAction(
    z.object({ kind, apiKey: z.string().trim().min(8, "Paste the full API key.").max(500), baseUrl: z.string().trim().max(300).optional(), defaultModel: z.string().trim().max(100).optional() }),
    input,
    async (data) => {
      const ctx = await requireOrgContext("credentials:manage");
      if (data.kind === "OPENAI_COMPATIBLE") {
        if (!data.baseUrl) throw new AppError("VALIDATION", "Enter the base URL of the OpenAI-compatible endpoint.", { fieldErrors: { baseUrl: "Required." } });
        assertSafeUrl(data.baseUrl, process.env.ALLOW_PRIVATE_NETWORK_TOOLS === "true");
        if (!data.defaultModel) throw new AppError("VALIDATION", "Enter the model name to use.", { fieldErrors: { defaultModel: "Required." } });
      }
      const actor = userActor(ctx.org.id, ctx.user.id);
      const cred = await createCredential(actor, { name: `${data.kind} API key`, type: "API_KEY", secret: data.apiKey });
      const existing = await prisma.aiProvider.findFirst({ where: { orgId: ctx.org.id, kind: data.kind } });
      if (existing?.credentialId) await revokeCredential(actor, existing.credentialId);
      await prisma.aiProvider.upsert({
        where: { orgId_kind_name: { orgId: ctx.org.id, kind: data.kind, name: data.kind } },
        create: { orgId: ctx.org.id, kind: data.kind, name: data.kind, credentialId: cred.id, baseUrl: data.baseUrl || null, defaultModel: data.defaultModel || null },
        update: { credentialId: cred.id, baseUrl: data.baseUrl || null, defaultModel: data.defaultModel || null, enabled: true },
      });
      await writeAudit({ orgId: ctx.org.id, actorType: "USER", actorUserId: ctx.user.id, action: "ai_provider.configure", metadata: { kind: data.kind } });
      revalidatePath("/settings/providers");
    },
  );
}

export async function removeProviderKeyAction(k: string): Promise<ActionResult> {
  return runAction(kind, k, async (providerKind) => {
    const ctx = await requireOrgContext("credentials:manage");
    const p = await prisma.aiProvider.findFirst({ where: { orgId: ctx.org.id, kind: providerKind } });
    if (!p) return;
    if (p.credentialId) await revokeCredential(userActor(ctx.org.id, ctx.user.id), p.credentialId);
    await prisma.aiProvider.delete({ where: { id: p.id } });
    revalidatePath("/settings/providers");
  });
}

/** Sends a tiny request to verify the key works (a real, billable call of a few tokens). */
export async function testProviderAction(k: string): Promise<ActionResult<{ model: string; latencyMs: number }>> {
  return runAction(kind, k, async (providerKind) => {
    const ctx = await requireOrgContext("credentials:manage");
    await enforceRateLimit("toolTest", ctx.org.id);
    const p = await prisma.aiProvider.findFirst({ where: { orgId: ctx.org.id, kind: providerKind } });
    const model = p?.defaultModel || DEFAULT_MODEL_BY_PROVIDER[providerKind];
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
