import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerAllJobHandlers } from "@/server/jobs/handlers";
import { drainJobs } from "@/server/jobs/queue";
import { addManualDocument, createKnowledgeBase, deleteDocument, setCollectionAccess } from "@/server/services/knowledge";
import { allowedKnowledgeBaseIds, searchKnowledge } from "@/server/services/knowledge-search";
import { runAgentInline } from "@/server/runtime/agent-runtime";
import { setProviderFactory } from "@/lib/ai/router";
import { createFixtureAgent, createFixtureOrg, resetDb } from "./helpers";

beforeAll(() => registerAllJobHandlers());
beforeEach(async () => {
  await resetDb();
  setProviderFactory(null); // real offline demo model
});
afterEach(() => setProviderFactory(null));

const REFUND = `## Refund Policy

Customers can request a full refund within 30 days of delivery. Refunds are issued to the original payment method within 5 business days.

## Exceptions

Gift cards and personalised items cannot be refunded.`;

describe("knowledge pipeline", () => {
  it("indexes, retrieves only allowed collections, cites sources, and forgets deleted documents", async () => {
    const { org, actor } = await createFixtureOrg();
    const agent = await createFixtureAgent(actor, {});
    const support = await createKnowledgeBase(actor, { name: "Support" });
    const secret = await createKnowledgeBase(actor, { name: "Board Minutes" });
    const doc = await addManualDocument(actor, support.id, { title: "Refund Policy", content: REFUND });
    await addManualDocument(actor, secret.id, { title: "Board minutes", content: "Confidential: the refund budget for next year is being cut in half by the board." });
    await drainJobs();

    const indexed = await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(indexed.status).toBe("INDEXED");
    expect(indexed.chunkCount).toBeGreaterThan(0);
    expect(indexed.embeddingModel).toBe("local-hash-v1");

    // Nothing assigned yet → the agent can read nothing.
    expect(await allowedKnowledgeBaseIds(org.id, agent.id, null)).toEqual([]);
    await setCollectionAccess(actor, support.id, { agentIds: [agent.id], departmentIds: [] });
    const allowed = await allowedKnowledgeBaseIds(org.id, agent.id, null);
    expect(allowed).toEqual([support.id]);

    const hits = await searchKnowledge(org.id, allowed, "how long do customers have to get a refund?");
    expect(hits[0]?.title).toBe("Refund Policy");
    expect(hits.every((h) => h.knowledgeBaseId === support.id)).toBe(true);

    // Offline model answers extractively from the permitted knowledge with a citation.
    const run = await runAgentInline(org.id, agent.id, { input: "How many days do customers have to request a refund?", mode: "LIVE", useDraft: true });
    expect(run.status).toBe("COMPLETED");
    expect(run.output).toContain("30 days");
    expect(run.output).not.toContain("board");
    const citations = run.citations as { title: string }[];
    expect(citations.map((c) => c.title)).toContain("Refund Policy");

    await deleteDocument(actor, doc.id);
    expect(await searchKnowledge(org.id, allowed, "refund within 30 days")).toEqual([]);
  });

  it("records a clear error for unreadable content", async () => {
    const { actor } = await createFixtureOrg();
    const kb = await createKnowledgeBase(actor, { name: "Empty" });
    const doc = await addManualDocument(actor, kb.id, { title: "Blank", content: "                          " });
    await drainJobs();
    const failed = await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toMatch(/No readable text/);
  });
});
