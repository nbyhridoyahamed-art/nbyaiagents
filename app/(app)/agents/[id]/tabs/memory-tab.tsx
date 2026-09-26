import { listMemories } from "@/server/services/memory";
import { MemoryList } from "./memory-list";

export async function MemoryTab({ agentId, orgId, canEdit }: { agentId: string; orgId: string; canEdit: boolean }) {
  const memories = await listMemories(orgId, agentId);
  return (
    <MemoryList
      agentId={agentId}
      canEdit={canEdit}
      memories={memories.map((m) => ({
        id: m.id,
        content: m.content,
        scope: m.scope,
        sourceType: m.sourceType,
        createdAt: m.createdAt.toISOString(),
      }))}
    />
  );
}
