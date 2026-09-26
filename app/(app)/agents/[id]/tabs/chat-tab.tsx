import { prisma } from "@/lib/db";
import type { AgentWithConfig } from "@/server/services/agents";
import { ChatPanel, type ChatMessage } from "./chat-panel";

export async function ChatTab({
  agent,
  orgId,
  userId,
  conversationId,
  canChat,
}: {
  agent: AgentWithConfig;
  orgId: string;
  userId: string;
  conversationId?: string;
  canChat: boolean;
}) {
  const conversations = await prisma.conversation.findMany({
    where: { orgId, agentId: agent.id, userId },
    orderBy: { lastMessageAt: "desc" },
    take: 30,
    select: { id: true, title: true, lastMessageAt: true },
  });
  const active = conversationId ? conversations.find((c) => c.id === conversationId) : undefined;
  const messages = active
    ? await prisma.message.findMany({ where: { conversationId: active.id }, orderBy: { createdAt: "asc" }, take: 200 })
    : [];
  const activeRun = active
    ? await prisma.agentRun.findFirst({
        where: { conversationId: active.id, status: { in: ["QUEUED", "RUNNING", "AWAITING_APPROVAL", "WAITING"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    : null;

  return (
    <ChatPanel
      key={active?.id ?? "new"}
      agent={{
        id: agent.id,
        name: agent.name,
        jobTitle: agent.jobTitle,
        color: agent.avatarColor,
        published: agent.lifecycle === "PUBLISHED",
        offline: agent.providerConfig?.provider === "OFFLINE",
        paused: agent.status === "PAUSED",
      }}
      canChat={canChat}
      conversations={conversations.map((c) => ({ id: c.id, title: c.title, lastMessageAt: c.lastMessageAt.toISOString() }))}
      conversationId={active?.id ?? null}
      initialMessages={messages.map(
        (m): ChatMessage => ({ id: m.id, role: m.role, content: m.content, metadata: (m.metadata as ChatMessage["metadata"]) ?? null, runId: m.runId, createdAt: m.createdAt.toISOString() }),
      )}
      activeRunId={activeRun?.id ?? null}
    />
  );
}
