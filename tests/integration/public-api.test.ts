import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/security/crypto";
import { registerAllJobHandlers } from "@/server/jobs/handlers";
import { drainJobs } from "@/server/jobs/queue";
import { createApiKey, revokeApiKey } from "@/server/services/api-keys";
import { signWebhookBody } from "@/server/services/webhooks";
import { publishWorkflow, simulateDraft } from "@/server/services/workflows";
import { createWorkflow } from "@/server/services/workflows";
import { decryptSecret } from "@/lib/security/crypto";
import type { WorkflowGraph } from "@/lib/workflows/types";
import { GET as listAgents } from "@/app/api/v1/agents/route";
import { POST as runAgent } from "@/app/api/v1/agents/[agentId]/run/route";
import { GET as getTask } from "@/app/api/v1/tasks/[taskId]/route";
import { POST as runWorkflow } from "@/app/api/v1/workflows/[workflowId]/run/route";
import { POST as webhook } from "@/app/api/webhooks/[key]/route";
import { createFixtureAgent, createFixtureOrg, resetDb } from "./helpers";

beforeAll(() => registerAllJobHandlers());
beforeEach(async () => {
  await resetDb();
});

const req = (url: string, init: RequestInit & { key?: string } = {}) =>
  new Request(`http://localhost${url}`, { ...init, headers: { "content-type": "application/json", ...(init.key ? { authorization: `Bearer ${init.key}` } : {}), ...(init.headers ?? {}) } });
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

async function publishedWebhookWorkflow(actor: Parameters<typeof createWorkflow>[0], requireSignature = true) {
  const graph: WorkflowGraph = {
    nodes: [
      { key: "t", type: "trigger.webhook", label: "Webhook", config: { requireSignature }, position: { x: 0, y: 0 } },
      { key: "set", type: "data.set", label: "Remember", config: { assignments: [{ name: "who", value: "{{trigger.name}}" }] }, position: { x: 200, y: 0 } },
    ],
    edges: [{ key: "e", source: "t", target: "set" }],
  };
  const wf = await createWorkflow(actor, { name: "Inbound", graph });
  await simulateDraft(actor, wf.id, { name: "test" });
  await drainJobs();
  await publishWorkflow(actor, wf.id);
  return prisma.webhook.findFirstOrThrow({ where: { workflowId: wf.id } });
}

describe("API keys", () => {
  it("stores only a hash, enforces scopes and stops working when revoked", async () => {
    const { org, user, actor } = await createFixtureOrg();
    await createFixtureAgent(actor, {});
    const { id, key } = await createApiKey({ ...actor, userId: user.id }, { name: "CI", scopes: ["agents:read"] });
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
    expect(row.hashedKey).toBe(sha256(key));
    expect(JSON.stringify(row)).not.toContain(key);

    const ok = await listAgents(req("/api/v1/agents", { key }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toHaveLength(1);
    expect((await listAgents(req("/api/v1/agents"))).status).toBe(401);
    expect((await listAgents(req("/api/v1/agents", { key: "nby_bogus_key" }))).status).toBe(401);

    const agent = await prisma.agent.findFirstOrThrow({ where: { orgId: org.id } });
    const denied = await runAgent(req(`/api/v1/agents/${agent.id}/run`, { method: "POST", key, body: JSON.stringify({ input: "Hi" }) }), params({ agentId: agent.id }));
    expect(denied.status).toBe(403);

    await revokeApiKey({ ...actor, userId: user.id }, id);
    expect((await listAgents(req("/api/v1/agents", { key }))).status).toBe(401);
    const expired = await createApiKey({ ...actor, userId: user.id }, { name: "Old", scopes: ["agents:read"], expiresInDays: 1 });
    await prisma.apiKey.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await listAgents(req("/api/v1/agents", { key: expired.key }))).status).toBe(401);
  });

  it("runs an employee through the API and reads the task back, scoped to the key's company", async () => {
    const { user, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {});
    const { key } = await createApiKey({ ...actor, userId: user.id }, { name: "App", scopes: ["agents:run", "tasks:read"] });

    const bad = await runAgent(req(`/api/v1/agents/${agent.id}/run`, { method: "POST", key, body: JSON.stringify({}) }), params({ agentId: agent.id }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.fields.input).toBeTruthy();

    const res = await runAgent(req(`/api/v1/agents/${agent.id}/run`, { method: "POST", key, body: JSON.stringify({ input: "Summarise our refund policy" }) }), params({ agentId: agent.id }));
    expect(res.status).toBe(202);
    const task = (await res.json()).data;
    await drainJobs();
    const got = await getTask(req(`/api/v1/tasks/${task.id}`, { key }), params({ taskId: task.id }));
    expect((await got.json()).data).toMatchObject({ id: task.id, status: "completed" });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "task.create", entityId: task.id } });
    expect(audit).toMatchObject({ actorType: "API_KEY" });

    const other = await createFixtureOrg("Other");
    const theirAgent = await createFixtureAgent(other.actor, {});
    const cross = await runAgent(req(`/api/v1/agents/${theirAgent.id}/run`, { method: "POST", key, body: JSON.stringify({ input: "x" }) }), params({ agentId: theirAgent.id }));
    expect(cross.status).toBe(404);
  });

  it("runs a published workflow once per idempotency key", async () => {
    const { user, actor } = await createFixtureOrg();
    const hook = await publishedWebhookWorkflow(actor);
    const { key } = await createApiKey({ ...actor, userId: user.id }, { name: "App", scopes: ["workflows:run"] });
    const call = () =>
      runWorkflow(req(`/api/v1/workflows/${hook.workflowId}/run`, { method: "POST", key, headers: { "idempotency-key": "order-42" }, body: JSON.stringify({ input: { name: "Ann" } }) }), params({ workflowId: hook.workflowId }));
    const a = (await (await call()).json()).data;
    const b = (await (await call()).json()).data;
    expect(a.id).toBe(b.id);
    expect(await prisma.workflowRun.count({ where: { workflowId: hook.workflowId, mode: "LIVE" } })).toBe(1);
  });
});

describe("webhooks", () => {
  it("accepts correctly signed requests and rejects forged, replayed or unsigned ones", async () => {
    const { actor } = await createFixtureOrg();
    const hook = await publishedWebhookWorkflow(actor);
    const secret = decryptSecret(hook.secretCiphertext);
    const body = JSON.stringify({ name: "Ann" });
    const send = (headers: Record<string, string>, b = body) => webhook(req(`/api/webhooks/${hook.key}`, { method: "POST", headers, body: b }), params({ key: hook.key }));

    expect((await send({})).status).toBe(401);
    expect((await send({ "x-nby-signature": signWebhookBody("wrong-secret", body) })).status).toBe(401);
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect((await send({ "x-nby-signature": signWebhookBody(secret, body, old) })).status).toBe(401);
    // Signature over a different body doesn't validate a tampered payload.
    expect((await send({ "x-nby-signature": signWebhookBody(secret, body) }, JSON.stringify({ name: "Mallory" }))).status).toBe(401);

    const ok = await send({ "x-nby-signature": signWebhookBody(secret, body), "idempotency-key": "d1" });
    expect(ok.status).toBe(202);
    const again = await send({ "x-nby-signature": signWebhookBody(secret, body), "idempotency-key": "d1" });
    expect((await again.json()).data.runId).toBe((await ok.json()).data.runId);
    await drainJobs();
    const run = await prisma.workflowRun.findFirstOrThrow({ where: { workflowId: hook.workflowId, mode: "LIVE" } });
    expect(run).toMatchObject({ status: "COMPLETED", trigger: "WEBHOOK" });
    expect((await prisma.webhook.findUniqueOrThrow({ where: { id: hook.id } })).lastReceivedAt).not.toBeNull();

    expect((await webhook(req(`/api/webhooks/nope`, { method: "POST", body }), params({ key: "nope" }))).status).toBe(404);
    const notJson = await send({ "x-nby-signature": signWebhookBody(secret, "[1,2]") }, "[1,2]");
    expect(notJson.status).toBe(422);
  });

  it("accepts an API key with workflows:run from the same company instead of a signature", async () => {
    const { user, actor } = await createFixtureOrg();
    const hook = await publishedWebhookWorkflow(actor);
    const good = await createApiKey({ ...actor, userId: user.id }, { name: "Zapier", scopes: ["workflows:run"] });
    const weak = await createApiKey({ ...actor, userId: user.id }, { name: "Read only", scopes: ["workflows:read"] });
    const send = (key: string) => webhook(req(`/api/webhooks/${hook.key}`, { method: "POST", key, body: JSON.stringify({ name: "Ann" }) }), params({ key: hook.key }));
    expect((await send(good.key)).status).toBe(202);
    expect((await send(weak.key)).status).toBe(403);
  });
});
