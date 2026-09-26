import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Activity } from "lucide-react";
import { prisma } from "@/lib/db";
import { EmptyState } from "@/components/common/empty-state";
import { RunStatusBadge } from "@/components/runs/run-status";

export async function ActivityTab({ agentId, orgId }: { agentId: string; orgId: string }) {
  const [runs, activity] = await Promise.all([
    prisma.agentRun.findMany({ where: { orgId, agentId }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.activityLog.findMany({ where: { orgId, actorAgentId: agentId }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section>
        <h2 className="mb-3 text-card-title">Runs</h2>
        {runs.length === 0 ? (
          <EmptyState icon={Activity} title="No runs yet" description="Every chat reply, task and workflow step this employee performs is recorded here." compact />
        ) : (
          <ul className="divide-y rounded-xl border bg-surface shadow-card">
            {runs.map((r) => (
              <li key={r.id}>
                <Link href={`/runs/${r.id}`} className="flex items-center gap-3 p-3.5 hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{r.input?.slice(0, 90) || "Run"}</p>
                    <p className="text-xs text-text-muted">
                      <span className="font-mono">{r.id}</span> · {r.model ?? "—"} · {r.inputTokens + r.outputTokens} tokens · ${r.costUsd.toFixed(4)} ·{" "}
                      {formatDistanceToNow(r.createdAt, { addSuffix: true })}
                    </p>
                  </div>
                  {r.mode === "SIMULATION" && <span className="rounded bg-ai-soft px-1.5 text-[11px] font-semibold text-ai">Simulation</span>}
                  <RunStatusBadge status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-3 text-card-title">Activity</h2>
        {activity.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-surface p-6 text-center text-[13px] text-text-muted">No activity yet.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-surface shadow-card">
            {activity.map((a) => (
              <li key={a.id} className="p-3.5">
                <p className="text-[13.5px]">{a.summary}</p>
                {a.detail && <p className="text-xs text-text-secondary">{a.detail}</p>}
                <p className="text-xs text-text-muted">{formatDistanceToNow(a.createdAt, { addSuffix: true })}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
