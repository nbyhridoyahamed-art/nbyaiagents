import { prisma } from "@/lib/db";
import type { AIProvider, ContentPart, GenerateRequest, GenerateResponse } from "@/lib/ai/types";
import { setProviderFactory } from "@/lib/ai/router";
import { userActor, type Actor } from "@/lib/auth/actor";
import { createOrganization } from "@/server/services/organizations";
import { connectIntegration } from "@/server/services/integrations";
import { createAgent, publishAgent, setAgentTools } from "@/server/services/agents";
import { hashPassword } from "@/lib/security/password";

/** Wipes every application table in the test database. */
export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
  }
}

let counter = 0;

export async function createFixtureOrg(name = "Test Co") {
  counter++;
  const user = await prisma.user.create({
    data: { email: `owner${counter}-${Date.now()}@acme.test`, name: "Owner", passwordHash: await hashPassword("test-password-123"), emailVerifiedAt: new Date() },
  });
  const org = await createOrganization(user.id, { name, timezone: "UTC", website: "https://acme.test" });
  const actor: Actor = userActor(org.id, user.id);
  return { user, org, actor };
}

export async function toolId(orgId: string, key: string) {
  return (await prisma.tool.findFirstOrThrow({ where: { orgId, key } })).id;
}

/** Creates and publishes an agent with the given tool grants (connecting mock integrations first). */
export async function createFixtureAgent(actor: Actor, grants: Record<string, "ALLOW" | "REQUIRE_APPROVAL" | "DENY">, overrides: Record<string, unknown> = {}) {
  const integrations = [...new Set(Object.keys(grants).map((k) => k.split(".")[0]))];
  for (const i of integrations) await connectIntegration(actor, i);
  const agent = await createAgent(actor, {
    name: "Sarah",
    jobTitle: "Sales Manager",
    mission: "Qualify leads",
    instructions: { ROLE: "You are the sales manager." },
    model: { provider: "OFFLINE", model: "offline-demo", temperature: 0.3, maxOutputTokens: 1000 },
    ...overrides,
  });
  const tools = [];
  for (const [key, effect] of Object.entries(grants)) tools.push({ toolId: await toolId(actor.orgId, key), effect });
  await setAgentTools(actor, agent.id, tools);
  await publishAgent(actor, agent.id);
  return agent;
}

/**
 * Scripted model: returns queued responses in order. Each script entry is a
 * function of the request so tests can assert on what the runtime sent.
 */
export function useScriptedModel(script: ((req: GenerateRequest) => ContentPart[])[]) {
  const calls: GenerateRequest[] = [];
  const provider: AIProvider = {
    kind: "OFFLINE",
    async generate(req): Promise<GenerateResponse> {
      calls.push(req);
      const step = script.shift();
      const content = step ? step(req) : [{ type: "text", text: "Done." } as ContentPart];
      return {
        content,
        stopReason: content.some((c) => c.type === "tool_call") ? "tool_use" : "end",
        usage: { inputTokens: 100, outputTokens: 20 },
        model: "offline-demo",
        provider: "OFFLINE",
      };
    },
  };
  setProviderFactory(async () => provider);
  return { calls, restore: () => setProviderFactory(null) };
}

export const call = (name: string, input: Record<string, unknown>, id = `call_${Math.random().toString(36).slice(2, 8)}`): ContentPart => ({
  type: "tool_call",
  id,
  name,
  input,
});

export const text = (t: string): ContentPart => ({ type: "text", text: t });
