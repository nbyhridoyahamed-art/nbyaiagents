import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { embedTexts } from "@/lib/knowledge/embeddings";

export interface KnowledgeHit {
  chunkId: string;
  documentId: string;
  knowledgeBaseId: string;
  title: string;
  fileName: string | null;
  pageNumber: number | null;
  heading: string | null;
  content: string;
  score: number;
}

/**
 * Knowledge collections an agent may read (spec §20): collections assigned to the
 * agent, to its department, and collections shared with the whole organization.
 */
export async function allowedKnowledgeBaseIds(orgId: string, agentId: string | null, departmentId: string | null, snapshotKbIds?: string[]): Promise<string[]> {
  const [assigned, orgWide] = await Promise.all([
    prisma.knowledgeAssignment.findMany({
      where: {
        orgId,
        OR: [...(agentId ? [{ agentId }] : []), ...(departmentId ? [{ departmentId }] : [])],
        knowledgeBase: { deletedAt: null },
      },
      select: { knowledgeBaseId: true, agentId: true },
    }),
    prisma.knowledgeBase.findMany({ where: { orgId, deletedAt: null, visibility: "ORGANIZATION" }, select: { id: true } }),
  ]);
  const ids = new Set<string>(orgWide.map((k) => k.id));
  for (const a of assigned) {
    // Agent-level grants must also be part of the executing version when one is given.
    if (a.agentId && snapshotKbIds && !snapshotKbIds.includes(a.knowledgeBaseId)) continue;
    ids.add(a.knowledgeBaseId);
  }
  return [...ids];
}

/**
 * Hybrid retrieval: vector similarity (per embedding model) blended with
 * PostgreSQL full-text rank. Only ever searches the given collections.
 */
export async function searchKnowledge(orgId: string, knowledgeBaseIds: string[], query: string, limit = 6): Promise<KnowledgeHit[]> {
  if (knowledgeBaseIds.length === 0 || !query.trim()) return [];
  const models = await prisma.knowledgeChunk.groupBy({
    by: ["embeddingModel"],
    where: { orgId, knowledgeBaseId: { in: knowledgeBaseIds }, document: { deletedAt: null, status: "INDEXED" } },
  });
  const hits: KnowledgeHit[] = [];
  for (const { embeddingModel } of models) {
    const [q] = await embedTexts(orgId, [query], embeddingModel);
    if (!q || q.model !== embeddingModel) continue;
    const rows = await prisma.$queryRaw<
      { id: string; documentId: string; knowledgeBaseId: string; content: string; heading: string | null; pageNumber: number | null; title: string; fileName: string | null; vscore: number; tscore: number }[]
    >`
      SELECT c."id", c."documentId", c."knowledgeBaseId", c."content", c."heading", c."pageNumber",
             d."title", d."fileName",
             vdo_cosine(c."embedding", ${q.vector}::double precision[]) AS vscore,
             ts_rank(to_tsvector('english', c."content"), plainto_tsquery('english', ${query})) AS tscore
      FROM "KnowledgeChunk" c
      JOIN "KnowledgeDocument" d ON d."id" = c."documentId"
      WHERE c."orgId" = ${orgId}
        AND c."knowledgeBaseId" IN (${Prisma.join(knowledgeBaseIds)})
        AND c."embeddingModel" = ${embeddingModel}
        AND d."deletedAt" IS NULL AND d."status" = 'INDEXED'
      ORDER BY (0.75 * vdo_cosine(c."embedding", ${q.vector}::double precision[])
              + 0.25 * LEAST(ts_rank(to_tsvector('english', c."content"), plainto_tsquery('english', ${query})) * 5, 1)) DESC
      LIMIT ${limit * 2}`;
    for (const r of rows) {
      const score = 0.75 * Number(r.vscore) + 0.25 * Math.min(Number(r.tscore) * 5, 1);
      hits.push({
        chunkId: r.id,
        documentId: r.documentId,
        knowledgeBaseId: r.knowledgeBaseId,
        title: r.title,
        fileName: r.fileName,
        pageNumber: r.pageNumber,
        heading: r.heading,
        content: r.content,
        score,
      });
    }
  }
  // A minimum relevance keeps unrelated text out of the model's context.
  return hits
    .filter((h) => h.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
