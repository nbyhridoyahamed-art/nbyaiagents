"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Loader2, Plug, ShieldAlert, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/common/empty-state";
import { PermissionSelect, type Effect } from "@/components/agents/permission-select";
import { RiskBadge, SimulatedBadge } from "@/components/tools/risk-badge";
import { useAction } from "@/hooks/use-action";
import type { RiskLevel } from "@/lib/generated/prisma/enums";
import { updateAgentToolsAction } from "../../actions";

interface Row {
  id: string;
  key: string;
  name: string;
  description: string;
  riskLevel: RiskLevel;
  capabilities: string[];
  isSimulated: boolean;
  enabled: boolean;
  connection: { name: string; status: string } | null;
  grant: Effect | null;
  policyNotes: { outcome: string; reason: string }[];
}

export function ToolsMatrix({ agentId, agentName, rows, canEdit }: { agentId: string; agentName: string; rows: Row[]; canEdit: boolean }) {
  const [grants, setGrants] = useState<Record<string, Effect | null>>(() => Object.fromEntries(rows.map((r) => [r.id, r.grant])));
  const save = useAction(updateAgentToolsAction, { success: "Permissions saved." });
  const dirty = useMemo(() => rows.some((r) => grants[r.id] !== r.grant), [rows, grants]);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Plug}
        title="No tools in this workspace yet"
        description="Connect an integration or build a custom REST API tool, then grant it to employees here."
        action={
          <Button asChild>
            <Link href="/integrations">Connect a tool</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-[13px] text-text-secondary">
          What {agentName} may do. Enforced by the platform before every action — company policies and approval rules are applied on top and
          can only make an action stricter.
        </p>
        {canEdit && (
          <Button
            disabled={!dirty || save.pending}
            onClick={() =>
              void save.run({
                agentId,
                tools: Object.entries(grants)
                  .filter(([, e]) => e !== null)
                  .map(([toolId, effect]) => ({ toolId, effect: effect! })),
              })
            }
          >
            {save.pending && <Loader2 className="animate-spin" aria-hidden />}
            Save permissions
          </Button>
        )}
      </div>
      <ul className="divide-y rounded-xl border bg-surface shadow-card">
        {rows.map((r) => {
          const grant = grants[r.id];
          return (
            <li key={r.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-start">
              <Switch
                checked={grant !== null}
                onCheckedChange={(v) => setGrants((g) => ({ ...g, [r.id]: v ? "REQUIRE_APPROVAL" : null }))}
                disabled={!canEdit}
                aria-label={`${grant !== null ? "Revoke" : "Grant"} ${r.name}`}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium">
                  <Link href={`/tools/${r.id}`} className="hover:underline">
                    {r.name}
                  </Link>
                  <RiskBadge risk={r.riskLevel} />
                  {r.isSimulated && <SimulatedBadge />}
                  {!r.enabled && <span className="rounded bg-surface-2 px-1.5 text-[11px] text-text-muted">Disabled</span>}
                  {r.connection && r.connection.status !== "CONNECTED" && (
                    <span className="rounded bg-danger-soft px-1.5 text-[11px] font-medium text-danger-text">{r.connection.name}: {r.connection.status.toLowerCase().replace("_", " ")}</span>
                  )}
                </p>
                <p className="text-xs text-text-muted">
                  {r.description} · <span className="font-mono">{r.key}</span>
                </p>
                {grant !== null && r.policyNotes.length > 0 && (
                  <ul className="mt-2 grid gap-1">
                    {r.policyNotes.map((n, i) => (
                      <li key={i} className={n.outcome === "DENY" ? "flex gap-1.5 text-xs text-danger-text" : "flex gap-1.5 text-xs text-warning-text"}>
                        {n.outcome === "DENY" ? <ShieldX className="size-3.5 shrink-0" aria-hidden /> : <ShieldAlert className="size-3.5 shrink-0" aria-hidden />}
                        {n.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {grant !== null && <PermissionSelect label={r.name} value={grant} onChange={(e) => setGrants((g) => ({ ...g, [r.id]: e }))} disabled={!canEdit} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
