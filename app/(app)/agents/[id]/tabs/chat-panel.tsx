"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ArrowUp, BookOpen, FlaskConical, Hand, Loader2, MessageSquarePlus, Square, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { RichText } from "@/components/common/rich-text";
import { ExecutionTimeline, type TimelineStep } from "@/components/runs/execution-timeline";
import { cn } from "@/lib/utils";
import { cancelChatRunAction, deleteConversationAction, sendChatMessageAction } from "../chat-actions";

export interface ChatMessage {
  id: string;
  role: "USER" | "AGENT" | "SYSTEM";
  content: string;
  runId: string | null;
  createdAt: string;
  metadata: {
    kind?: "answer" | "approval" | "question" | "error";
    approvalId?: string;
    offline?: boolean;
    simulation?: boolean;
    citations?: { label: string; documentId: string; title: string; page: number | null; excerpt: string }[];
  } | null;
}

interface LiveRun {
  id: string;
  status: string;
  mode: string;
  offline: boolean;
  error: string | null;
  steps: (TimelineStep & { type: string; approvalId: string | null })[];
}

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const PAUSED = new Set(["AWAITING_APPROVAL", "WAITING"]);

export function ChatPanel({
  agent,
  canChat,
  conversations,
  conversationId: initialConversationId,
  initialMessages,
  activeRunId,
}: {
  agent: { id: string; name: string; jobTitle: string; color: string; published: boolean; offline: boolean; paused: boolean };
  canChat: boolean;
  conversations: { id: string; title: string; lastMessageAt: string }[];
  conversationId: string | null;
  initialMessages: ChatMessage[];
  activeRunId: string | null;
}) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [messages, setMessages] = useState(initialMessages);
  const [runId, setRunId] = useState<string | null>(activeRunId);
  const [live, setLive] = useState<LiveRun | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessageId = messages[messages.length - 1]?.id;

  const poll = useCallback(async () => {
    if (!runId) return;
    const res = await fetch(`/api/runs/${runId}${lastMessageId ? `?after=${lastMessageId}` : ""}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { run: LiveRun; messages: ChatMessage[] };
    setLive(data.run);
    if (data.messages.length) setMessages((prev) => [...prev, ...data.messages.filter((m) => !prev.some((p) => p.id === m.id))]);
    if (TERMINAL.has(data.run.status) || PAUSED.has(data.run.status)) {
      if (TERMINAL.has(data.run.status)) setRunId(null);
      router.refresh();
    }
  }, [runId, lastMessageId, router]);

  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      await poll();
      if (!stopped) timer = setTimeout(tick, 1000);
    };
    let timer = setTimeout(tick, 300);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runId, poll]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, live?.steps.length]);

  async function send() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    const optimistic: ChatMessage = { id: `local-${Date.now()}`, role: "USER", content: value, runId: null, createdAt: new Date().toISOString(), metadata: null };
    setMessages((m) => [...m, optimistic]);
    setText("");
    const res = await sendChatMessageAction({ agentId: agent.id, conversationId, text: value });
    setSending(false);
    if (!res.ok) {
      toast.error(res.error);
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setText(value);
      return;
    }
    if (!conversationId) {
      setConversationId(res.data.conversationId);
      window.history.replaceState(null, "", `/agents/${agent.id}?tab=chat&conversation=${res.data.conversationId}`);
    }
    setLive(null);
    setRunId(res.data.runId);
  }

  const working = !!runId && (!live || !TERMINAL.has(live.status));
  const pausedRun = live && PAUSED.has(live.status);

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <Button asChild variant="outline" className="w-full justify-start">
          <Link href={`/agents/${agent.id}?tab=chat`}>
            <MessageSquarePlus aria-hidden /> New conversation
          </Link>
        </Button>
        <ul className="mt-3 grid gap-0.5">
          {conversations.map((c) => (
            <li key={c.id} className="group flex items-center">
              <Link
                href={`/agents/${agent.id}?tab=chat&conversation=${c.id}`}
                className={cn("min-w-0 flex-1 rounded-lg px-2.5 py-2 text-[13px] hover:bg-surface-2", c.id === conversationId && "bg-brand-soft text-brand-hover")}
              >
                <span className="block truncate">{c.title}</span>
                <span className="block text-[11px] text-text-muted">{formatDistanceToNow(new Date(c.lastMessageAt), { addSuffix: true })}</span>
              </Link>
              <button
                type="button"
                className="ml-1 hidden rounded p-1 text-text-muted hover:text-danger group-hover:block"
                aria-label={`Delete conversation ${c.title}`}
                onClick={async () => {
                  const r = await deleteConversationAction(c.id);
                  if (r.ok) router.push(`/agents/${agent.id}?tab=chat`);
                }}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex min-h-[560px] flex-col rounded-2xl border bg-surface shadow-card" aria-label={`Chat with ${agent.name}`}>
        {(!agent.published || agent.offline) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-b bg-surface-2/60 px-4 py-2 text-xs">
            {!agent.published && (
              <span className="flex items-center gap-1.5 font-medium text-ai">
                <FlaskConical className="size-3.5" aria-hidden /> Test mode — {agent.name} is a draft, so every action is simulated.
              </span>
            )}
            {agent.offline && (
              <span className="flex items-center gap-1.5 text-warning-text">
                <TriangleAlert className="size-3.5" aria-hidden /> Offline demo model: rule-based answers, not AI.{" "}
                <Link href="/settings/providers" className="font-medium underline">
                  Connect a provider
                </Link>
              </span>
            )}
          </div>
        )}

        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6" aria-live="polite">
          {messages.length === 0 && !working && (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center">
              <AgentAvatar name={agent.name} color={agent.color} size={56} />
              <p className="mt-3 text-card-title">Chat with {agent.name}</p>
              <p className="max-w-sm text-[13px] text-text-secondary">
                Give {agent.name} a task, ask a question, or request work that uses their knowledge and tools.
              </p>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} agent={agent} />
          ))}
          {working && live && !pausedRun && (
            <div className="flex gap-3">
              <AgentAvatar name={agent.name} color={agent.color} size={32} />
              <div className="min-w-0 rounded-2xl rounded-tl-sm border bg-background px-4 py-3">
                <p className="mb-2 text-[13px] font-medium">{agent.name} is working…</p>
                <ExecutionTimeline steps={live.steps} pendingLabel={live.status === "QUEUED" ? "Starting" : undefined} />
              </div>
            </div>
          )}
          {working && !live && (
            <p className="flex items-center gap-2 text-[13px] text-text-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {agent.name} is starting…
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          className="border-t p-3 sm:p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="flex items-end gap-2 rounded-xl border bg-background p-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={
                !canChat ? "You don't have permission to chat." : agent.paused ? `${agent.name} is paused.` : `Message ${agent.name}…`
              }
              disabled={!canChat || agent.paused || working}
              rows={1}
              className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
              aria-label="Message"
            />
            {working && runId ? (
              <Button type="button" variant="outline" size="icon" onClick={() => void cancelChatRunAction(runId).then(() => setRunId(null))} aria-label="Stop">
                <Square className="size-3.5" aria-hidden />
              </Button>
            ) : (
              <Button type="submit" size="icon" disabled={!text.trim() || sending || !canChat || agent.paused} aria-label="Send">
                {sending ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUp aria-hidden />}
              </Button>
            )}
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-text-muted">Enter to send · Shift+Enter for a new line · Actions are permission-checked by the platform.</p>
        </form>
      </section>
    </div>
  );
}

function MessageBubble({ message, agent }: { message: ChatMessage; agent: { name: string; color: string } }) {
  if (message.role === "USER") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-brand px-4 py-2.5 text-[14px] text-white">{message.content}</div>
      </div>
    );
  }
  const meta = message.metadata ?? {};
  const citations = meta.citations ?? [];
  const isApproval = meta.kind === "approval";
  const isQuestion = meta.kind === "question";
  return (
    <div className="flex gap-3">
      <AgentAvatar name={agent.name} color={agent.color} size={32} />
      <div className="min-w-0 max-w-[85%]">
        <div
          className={cn(
            "rounded-2xl rounded-tl-sm border px-4 py-2.5 text-[14px]",
            isApproval || isQuestion ? "border-warning/40 bg-warning-soft" : meta.kind === "error" ? "border-danger/30 bg-danger-soft" : "bg-background",
          )}
        >
          {(isApproval || isQuestion) && (
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warning-text">
              <Hand className="size-3.5" aria-hidden /> {isApproval ? "Approval required" : "Needs your input"}
            </p>
          )}
          <RichText text={message.content} onCite={(label) => <sup className="mx-0.5 rounded bg-brand-soft px-1 text-[10px] font-semibold text-brand-hover">{label}</sup>} />
          {(isApproval || isQuestion) && (
            <Button asChild size="sm" className="mt-2">
              <Link href={isApproval ? `/approvals?focus=${meta.approvalId}` : "/inbox"}>{isApproval ? "Review approval" : "Answer in inbox"}</Link>
            </Button>
          )}
        </div>
        {citations.length > 0 && (
          <div className="mt-2 grid gap-1.5">
            {citations.map((c) => (
              <Link
                key={`${c.documentId}-${c.label}`}
                href={`/knowledge/documents/${c.documentId}${c.page ? `?page=${c.page}` : ""}`}
                className="flex items-start gap-2 rounded-lg border bg-surface px-3 py-2 text-xs hover:bg-surface-2"
              >
                <BookOpen className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
                <span className="min-w-0">
                  <span className="font-medium text-foreground">
                    [{c.label}] {c.title}
                    {c.page ? ` · Page ${c.page}` : ""}
                  </span>
                  <span className="line-clamp-2 block text-text-muted">{c.excerpt}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
        <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-text-muted">
          {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
          {meta.offline && <span className="font-medium text-warning-text">Offline demo model — not AI</span>}
          {meta.simulation && <span className="font-medium text-ai">Simulation — no real actions</span>}
          {message.runId && (
            <Link href={`/runs/${message.runId}`} className="hover:underline">
              View run
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}
