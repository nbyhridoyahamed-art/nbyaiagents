"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireOrgContext } from "@/lib/auth/context";
import { userActor } from "@/lib/auth/actor";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { capabilityKeys } from "@/lib/policies/types";
import { connectGitHub, connectIntegration, connectShopify, connectWebSearch, disconnectIntegration } from "@/server/services/integrations";
import { createCredential, revokeCredential, rotateCredential } from "@/server/services/credentials";
import { createCustomTool, deleteTool, setToolEnabled, setToolRisk, testTool, updateCustomTool } from "@/server/services/tools";
import { redact } from "@/lib/security/redact";

const id = z.string().min(1).max(40);
const risk = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export async function connectIntegrationAction(key: string): Promise<ActionResult> {
  return runAction(z.string().min(1).max(60), key, async (k) => {
    const ctx = await requireOrgContext("tools:manage");
    await connectIntegration(userActor(ctx.org.id, ctx.user.id), k);
    revalidatePath("/integrations");
  });
}

export async function disconnectIntegrationAction(key: string): Promise<ActionResult> {
  return runAction(z.string().min(1).max(60), key, async (k) => {
    const ctx = await requireOrgContext("tools:manage");
    await disconnectIntegration(userActor(ctx.org.id, ctx.user.id), k);
    revalidatePath("/integrations");
  });
}

const shopifyConnectSchema = z.object({ shop: z.string().trim().min(1).max(120), accessToken: z.string().trim().min(1).max(500) });

export async function connectShopifyAction(input: z.input<typeof shopifyConnectSchema>): Promise<ActionResult> {
  return runAction(shopifyConnectSchema, input, async (d) => {
    const ctx = await requireOrgContext("tools:manage");
    await connectShopify(userActor(ctx.org.id, ctx.user.id), d);
    revalidatePath("/integrations");
  });
}

const webSearchConnectSchema = z.object({ apiKey: z.string().trim().min(1, "Paste your Tavily API key.").max(300) });

export async function connectWebSearchAction(input: z.input<typeof webSearchConnectSchema>): Promise<ActionResult> {
  return runAction(webSearchConnectSchema, input, async (d) => {
    const ctx = await requireOrgContext("tools:manage");
    await enforceRateLimit("toolTest", `${ctx.org.id}:${ctx.user.id}`);
    await connectWebSearch(userActor(ctx.org.id, ctx.user.id), d);
    revalidatePath("/integrations");
  });
}

const gitHubConnectSchema = z.object({ token: z.string().trim().min(1, "Paste your GitHub token.").max(500) });

export async function connectGitHubAction(input: z.input<typeof gitHubConnectSchema>): Promise<ActionResult> {
  return runAction(gitHubConnectSchema, input, async (d) => {
    const ctx = await requireOrgContext("tools:manage");
    await enforceRateLimit("toolTest", `${ctx.org.id}:${ctx.user.id}`);
    await connectGitHub(userActor(ctx.org.id, ctx.user.id), d);
    revalidatePath("/integrations");
  });
}

const customToolSchema = z.object({
  name: z.string().trim().min(2, "Name the tool.").max(80),
  key: z.string().trim().max(60).default(""),
  description: z.string().trim().min(10, "Describe what the tool does so employees know when to use it.").max(500),
  riskLevel: risk,
  capabilities: z.array(z.enum(capabilityKeys)).max(10).default([]),
  httpConfig: z.unknown(),
});

export async function saveCustomToolAction(input: z.input<typeof customToolSchema> & { toolId?: string }): Promise<ActionResult<{ id: string }>> {
  return runAction(customToolSchema.extend({ toolId: id.optional() }), input, async ({ toolId, ...data }) => {
    const ctx = await requireOrgContext("tools:manage");
    const actor = userActor(ctx.org.id, ctx.user.id);
    const tool = toolId ? await updateCustomTool(actor, toolId, data) : await createCustomTool(actor, data);
    revalidatePath("/tools");
    return { id: tool.id };
  });
}

export async function setToolEnabledAction(input: { toolId: string; enabled: boolean }): Promise<ActionResult> {
  return runAction(z.object({ toolId: id, enabled: z.boolean() }), input, async (d) => {
    const ctx = await requireOrgContext("tools:manage");
    await setToolEnabled(userActor(ctx.org.id, ctx.user.id), d.toolId, d.enabled);
    revalidatePath("/tools");
  });
}

export async function setToolRiskAction(input: { toolId: string; riskLevel: string }): Promise<ActionResult> {
  return runAction(z.object({ toolId: id, riskLevel: risk }), input, async (d) => {
    const ctx = await requireOrgContext("policies:manage");
    await setToolRisk(userActor(ctx.org.id, ctx.user.id), d.toolId, d.riskLevel);
    revalidatePath(`/tools/${d.toolId}`);
  });
}

export async function deleteToolAction(toolId: string): Promise<ActionResult> {
  return runAction(id, toolId, async (t) => {
    const ctx = await requireOrgContext("tools:manage");
    await deleteTool(userActor(ctx.org.id, ctx.user.id), t);
    revalidatePath("/tools");
  });
}

export async function testToolAction(input: { toolId: string; input: unknown; mode: "LIVE" | "SIMULATION" }): Promise<ActionResult<{ output: string; summary: string; simulated: boolean; latencyMs: number }>> {
  return runAction(z.object({ toolId: id, input: z.unknown(), mode: z.enum(["LIVE", "SIMULATION"]) }), input, async (d) => {
    const ctx = await requireOrgContext("tools:manage");
    await enforceRateLimit("toolTest", `${ctx.org.id}:${ctx.user.id}`);
    const res = await testTool(userActor(ctx.org.id, ctx.user.id), d.toolId, d.input, d.mode);
    return { output: JSON.stringify(redact(res.output), null, 2).slice(0, 20000), summary: res.summary, simulated: res.simulated, latencyMs: res.latencyMs };
  });
}

// ── Credentials ──────────────────────────────────────────────────────────────

export async function createCredentialAction(input: { name: string; type: string; secret: string }): Promise<ActionResult<{ id: string; name: string; hint: string | null }>> {
  return runAction(
    z.object({
      name: z.string().trim().min(2, "Name the credential.").max(80),
      type: z.enum(["API_KEY", "BEARER_TOKEN", "BASIC_AUTH", "OAUTH2"]),
      secret: z.string().min(4, "Paste the secret.").max(5000),
    }),
    input,
    async (d) => {
      const ctx = await requireOrgContext("credentials:manage");
      const cred = await createCredential(userActor(ctx.org.id, ctx.user.id), d);
      revalidatePath("/tools");
      return { id: cred.id, name: cred.name, hint: cred.hint };
    },
  );
}

export async function rotateCredentialAction(input: { id: string; secret: string }): Promise<ActionResult> {
  return runAction(z.object({ id, secret: z.string().min(4).max(5000) }), input, async (d) => {
    const ctx = await requireOrgContext("credentials:manage");
    await rotateCredential(userActor(ctx.org.id, ctx.user.id), d.id, d.secret);
    revalidatePath("/tools");
  });
}

export async function revokeCredentialAction(credId: string): Promise<ActionResult> {
  return runAction(id, credId, async (c) => {
    const ctx = await requireOrgContext("credentials:manage");
    await revokeCredential(userActor(ctx.org.id, ctx.user.id), c);
    revalidatePath("/tools");
  });
}
