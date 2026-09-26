import { prisma } from "@/lib/db";
import type { AgentWithConfig } from "@/server/services/agents";
import { KnowledgeAssign } from "./knowledge-assign";

export async function KnowledgeTab({ agent, orgId, canEdit }: { agent: AgentWithConfig; orgId: string; canEdit: boolean }) {
  const [collections, inherited] = await Promise.all([
    prisma.knowledgeBase.findMany({
      where: { orgId, deletedAt: null },
      include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
      orderBy: { name: "asc" },
    }),
    agent.departmentId
      ? prisma.knowledgeAssignment.findMany({ where: { departmentId: agent.departmentId, knowledgeBase: { deletedAt: null } }, include: { knowledgeBase: true } })
      : Promise.resolve([]),
  ]);
  return (
    <KnowledgeAssign
      agentId={agent.id}
      agentName={agent.name}
      canEdit={canEdit}
      assigned={agent.knowledge.map((k) => k.knowledgeBaseId)}
      collections={collections.map((c) => ({ id: c.id, name: c.name, description: c.description, documents: c._count.documents, visibility: c.visibility }))}
      inherited={inherited.map((i) => ({ id: i.knowledgeBaseId, name: i.knowledgeBase.name }))}
      department={agent.department?.name ?? null}
    />
  );
}
