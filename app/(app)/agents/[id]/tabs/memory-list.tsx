"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Brain, Building2, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/common/empty-state";
import { useAction } from "@/hooks/use-action";
import { addMemoryAction, deleteMemoryAction } from "./memory-actions";

interface MemoryRow {
  id: string;
  content: string;
  scope: "LONG_TERM" | "ORGANIZATION";
  sourceType: string | null;
  createdAt: string;
}

export function MemoryList({ agentId, canEdit, memories }: { agentId: string; canEdit: boolean; memories: MemoryRow[] }) {
  const [content, setContent] = useState("");
  const [scope, setScope] = useState<"LONG_TERM" | "ORGANIZATION">("LONG_TERM");
  const add = useAction(addMemoryAction, { success: "Memory saved.", onSuccess: () => setContent("") });
  const remove = useAction(deleteMemoryAction, { success: "Memory deleted." });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section>
        <p className="mb-4 text-[13px] text-text-secondary">
          Long-term memories are explicit facts this employee recalls when relevant. They never contain hidden model reasoning, and you can delete
          any of them.
        </p>
        {memories.length === 0 ? (
          <EmptyState icon={Brain} title="No memories yet" description="Memories are added by you, or by the employee when it learns a durable fact during work." compact />
        ) : (
          <ul className="divide-y rounded-xl border bg-surface shadow-card">
            {memories.map((m) => (
              <li key={m.id} className="flex gap-3 p-4">
                {m.scope === "ORGANIZATION" ? (
                  <Building2 className="mt-0.5 size-4 shrink-0 text-info" aria-label="Organization memory" />
                ) : (
                  <Brain className="mt-0.5 size-4 shrink-0 text-ai" aria-label="Long-term memory" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px]">{m.content}</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {m.scope === "ORGANIZATION" ? "Organization memory" : "Long-term"} · {m.sourceType ?? "manual"} ·{" "}
                    {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                  </p>
                </div>
                {canEdit && (
                  <Button variant="ghost" size="icon-sm" onClick={() => void remove.run(m.id)} disabled={remove.pending} aria-label="Delete memory">
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {canEdit && (
        <section className="h-fit rounded-xl border bg-surface p-5 shadow-card">
          <h2 className="text-card-title">Add a memory</h2>
          <form
            className="mt-3 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void add.run({ agentId, content, scope });
            }}
          >
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} maxLength={2000} placeholder="e.g. Our biggest customer, Globex, prefers calls on Tuesdays." aria-label="Memory" />
            <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
              <SelectTrigger className="h-10 w-full" aria-label="Scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LONG_TERM">Only this employee</SelectItem>
                <SelectItem value="ORGANIZATION">Everyone (organization memory)</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={add.pending || content.trim().length < 3}>
              {add.pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />} Save memory
            </Button>
          </form>
        </section>
      )}
    </div>
  );
}
