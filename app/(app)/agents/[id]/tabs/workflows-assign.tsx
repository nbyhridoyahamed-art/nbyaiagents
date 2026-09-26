"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/common/empty-state";
import { useAction } from "@/hooks/use-action";
import { updateAgentWorkflowsAction } from "../../actions";

export function WorkflowsAssign({
  agentId,
  canEdit,
  assigned,
  workflows,
}: {
  agentId: string;
  canEdit: boolean;
  assigned: string[];
  workflows: { id: string; name: string; status: string; description: string | null; runs: number }[];
}) {
  const [ids, setIds] = useState(assigned);
  const save = useAction(updateAgentWorkflowsAction, { success: "Workflows saved." });
  const dirty = ids.length !== assigned.length || ids.some((i) => !assigned.includes(i));

  if (workflows.length === 0) {
    return (
      <EmptyState
        icon={Workflow}
        title="No workflows are active yet."
        description="Turn repetitive work into automation."
        action={
          <Button asChild>
            <Link href="/workflows/new">Create Workflow</Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        {canEdit && (
          <Button disabled={!dirty || save.pending} onClick={() => void save.run({ agentId, workflowIds: ids })}>
            {save.pending && <Loader2 className="animate-spin" aria-hidden />} Save
          </Button>
        )}
      </div>
      <ul className="divide-y rounded-xl border bg-surface shadow-card">
        {workflows.map((w) => (
          <li key={w.id} className="flex items-center gap-3 p-4">
            <Checkbox
              checked={ids.includes(w.id)}
              disabled={!canEdit}
              onCheckedChange={(v) => setIds((p) => (v ? [...p, w.id] : p.filter((x) => x !== w.id)))}
              aria-label={`Assign ${w.name}`}
            />
            <div className="min-w-0 flex-1">
              <Link href={`/workflows/${w.id}`} className="text-[13.5px] font-medium hover:underline">
                {w.name}
              </Link>
              {w.description && <p className="truncate text-xs text-text-muted">{w.description}</p>}
            </div>
            <span className="text-xs capitalize text-text-muted">
              {w.status.toLowerCase()} · {w.runs} run{w.runs === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
