import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/actor";
import { writeAudit } from "@/server/services/audit";
import { embedTexts, cosineSimilarity } from "@/lib/knowledge/embeddings";

/**
 * Agent memory.
 *  - Short-term memory: the conversation / run transcript (not stored here).
 *  - Long-term memory: durable facts an employee should remember (this table, scope LONG_TERM).
 *  - Organization memory: facts every employee may use (scope ORGANIZATION).
 *  - Workflow state: stored on WorkflowRun.state.
 * Memories are explicit statements — never hidden model reasoning — and can be
 * inspected and deleted by the owner at any time.
 */

export async function listMemories(orgId: string, agentId: string) {
  return prisma.agentMemory.findMany({
    where: { orgId, OR: [{ agentId }, { scope: "ORGANIZATION" }] },
    orderBy: [{ scope: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function addMemory(
  actor: Actor,
  input: { agentId: string | null; content: string; scope: "LONG_TERM" | "ORGANIZATION"; importance?: number; sourceType?: string; sourceId?: string },
) {
  const content = input.content.trim();
  if (content.length < 3) throw new AppError("VALIDATION", "Memory is too short.");
  if (input.agentId) {
    const agent = await prisma.agent.findFirst({ where: { id: input.agentId, orgId: actor.orgId, deletedAt: null } });
    if (!agent) throw notFound("AI employee");
  }
  const [embedding] = await embedTexts(actor.orgId, [content]);
  const memory = await prisma.agentMemory.create({
    data: {
      orgId: actor.orgId,
      agentId: input.scope === "ORGANIZATION" ? null : input.agentId,
      scope: input.scope,
      content: content.slice(0, 2000),
      importance: input.importance ?? 3,
      sourceType: input.sourceType ?? (actor.type === "USER" ? "manual" : "agent"),
      sourceId: input.sourceId,
      embedding: embedding.vector,
      createdByUserId: actor.userId ?? null,
    },
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, actorAgentId: actor.agentId, action: "memory.create", entityType: "AgentMemory", entityId: memory.id });
  return memory;
}

export async function deleteMemory(actor: Actor, memoryId: string) {
  const memory = await prisma.agentMemory.findFirst({ where: { id: memoryId, orgId: actor.orgId } });
  if (!memory) throw notFound("Memory");
  await prisma.agentMemory.delete({ where: { id: memoryId } });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "memory.delete", entityType: "AgentMemory", entityId: memoryId });
}

/** Most relevant memories for a query (agent's own long-term + organization memory). */
export async function recallMemories(orgId: string, agentId: string, query: string, limit = 5) {
  const memories = await prisma.agentMemory.findMany({
    where: { orgId, OR: [{ agentId }, { scope: "ORGANIZATION" }] },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  if (memories.length === 0 || !query.trim()) return [];
  const [q] = await embedTexts(orgId, [query]);
  return memories
    .map((m) => ({ memory: m, score: m.embedding.length === q.vector.length ? cosineSimilarity(q.vector, m.embedding) + m.importance * 0.01 : 0 }))
    .filter((x) => x.score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.memory);
}
