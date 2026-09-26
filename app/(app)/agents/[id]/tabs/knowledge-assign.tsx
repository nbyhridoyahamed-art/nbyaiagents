"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/common/empty-state";
import { useAction } from "@/hooks/use-action";
import { updateAgentKnowledgeAction } from "../../actions";

export function KnowledgeAssign({
  agentId,
  agentName,
  canEdit,
  assigned,
  collections,
  inherited,
  department,
}: {
  agentId: string;
  agentName: string;
  canEdit: boolean;
  assigned: string[];
  collections: { id: string; name: string; description: string | null; documents: number; visibility: string }[];
  inherited: { id: string; name: string }[];
  department: string | null;
}) {
  const [ids, setIds] = useState(assigned);
  const save = useAction(updateAgentKnowledgeAction, { success: "Knowledge access saved." });
  const dirty = ids.length !== assigned.length || ids.some((i) => !assigned.includes(i));

  if (collections.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="Your AI employees need knowledge."
        description="Add policies, documents or product information."
        action={
          <Button asChild>
            <Link href="/knowledge">Add Knowledge</Link>
          </Button>
        }
      />
    );
  }

  const orgWide = collections.filter((c) => c.visibility === "ORGANIZATION");
  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-[13px] text-text-secondary">
          Knowledge {agentName} may search. Retrieval is filtered by these assignments at query time — unassigned collections are never read.
        </p>
        {canEdit && (
          <Button disabled={!dirty || save.pending} onClick={() => void save.run({ agentId, knowledgeBaseIds: ids })}>
            {save.pending && <Loader2 className="animate-spin" aria-hidden />} Save access
          </Button>
        )}
      </div>
      <ul className="grid gap-2 md:grid-cols-2">
        {collections.map((c) => {
          const viaDept = inherited.some((i) => i.id === c.id);
          const viaOrg = c.visibility === "ORGANIZATION";
          return (
            <li key={c.id}>
              <label className="flex h-full cursor-pointer items-start gap-3 rounded-xl border bg-surface p-4 shadow-card">
                <Checkbox
                  checked={ids.includes(c.id) || viaDept || viaOrg}
                  disabled={!canEdit || viaDept || viaOrg}
                  onCheckedChange={(v) => setIds((p) => (v ? [...p, c.id] : p.filter((x) => x !== c.id)))}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <Link href={`/knowledge/${c.id}`} className="block text-[13.5px] font-medium hover:underline">
                    {c.name}
                  </Link>
                  <span className="block text-xs text-text-muted">
                    {c.documents} document{c.documents === 1 ? "" : "s"}
                    {viaOrg ? " · shared with everyone" : viaDept ? ` · via ${department} department` : ""}
                  </span>
                  {c.description && <span className="mt-1 block text-[13px] text-text-secondary">{c.description}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {orgWide.length > 0 && <p className="text-xs text-text-muted">Collections shared with everyone are readable by every employee.</p>}
    </div>
  );
}
