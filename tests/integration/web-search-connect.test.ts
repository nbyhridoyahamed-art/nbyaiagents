import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/security/crypto";
import { connectWebSearch, disconnectIntegration } from "@/server/services/integrations";
import { createFixtureOrg, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterEach(() => vi.restoreAllMocks());

const KEY = "tvly-test-key-abcdef1234567890";
const reply = (status: number) => new Response(JSON.stringify({ results: [] }), { status });

describe("connectWebSearch (Tavily key pasted on the Integrations page)", () => {
  it("rejects a key Tavily doesn't accept and saves nothing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(401));
    const { actor } = await createFixtureOrg();
    await expect(connectWebSearch(actor, { apiKey: KEY })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await prisma.toolCredential.count({ where: { orgId: actor.orgId } })).toBe(0);
    expect(await prisma.integrationConnection.count({ where: { orgId: actor.orgId, integrationKey: "web_search" } })).toBe(0);
  });

  it("rejects input that can't be a key without calling Tavily", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { actor } = await createFixtureOrg();
    for (const apiKey of ["", "short", "tvly has spaces in it 1234567890"]) {
      await expect(connectWebSearch(actor, { apiKey })).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores the key encrypted, connects the tools and keeps the plain key out of the audit log", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200));
    const { actor } = await createFixtureOrg();

    const conn = await connectWebSearch(actor, { apiKey: `  ${KEY}  ` });

    expect(conn.status).toBe("CONNECTED");
    expect(conn.isSimulated).toBe(false);
    const cred = await prisma.toolCredential.findFirstOrThrow({ where: { orgId: actor.orgId } });
    expect(conn.credentialId).toBe(cred.id);
    expect(cred.ciphertext).not.toContain(KEY);
    expect(decryptSecret(cred.ciphertext)).toBe(KEY);

    const tools = await prisma.tool.findMany({ where: { orgId: actor.orgId, integrationKey: "web_search" }, orderBy: { key: "asc" } });
    expect(tools.map((t) => t.key)).toEqual(["web_search.company_profile", "web_search.search"]);
    expect(tools.every((t) => t.enabled && !t.isSimulated)).toBe(true);

    const audit = await prisma.auditLog.findMany({ where: { orgId: actor.orgId } });
    expect(audit.some((a) => a.action === "integration.connect")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("can be disconnected and reconnected with a different key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200));
    const { actor } = await createFixtureOrg();
    await connectWebSearch(actor, { apiKey: KEY });
    await disconnectIntegration(actor, "web_search");
    expect((await prisma.tool.findFirstOrThrow({ where: { orgId: actor.orgId, key: "web_search.search" } })).enabled).toBe(false);

    const newKey = "tvly-another-key-0987654321zz";
    const conn = await connectWebSearch(actor, { apiKey: newKey });
    expect(conn.status).toBe("CONNECTED");
    const cred = await prisma.toolCredential.findUniqueOrThrow({ where: { id: conn.credentialId! } });
    expect(decryptSecret(cred.ciphertext)).toBe(newKey);
    expect((await prisma.tool.findFirstOrThrow({ where: { orgId: actor.orgId, key: "web_search.search" } })).enabled).toBe(true);
  });
});
