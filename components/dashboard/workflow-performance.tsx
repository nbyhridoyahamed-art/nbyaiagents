import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Plus, Workflow } from "lucide-react";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { WorkflowStatusBadge } from "@/components/workflows/workflow-status";
import { Button } from "@/components/ui/button";
import type { WorkflowPerformanceRow } from "@/server/services/dashboard";

const ago = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "never");
const pct = (n: number | null) => (n === null ? "—" : `${n}%`);

/** Workflow performance (spec §90). Table on tablet/desktop, cards on mobile (§92). Live runs only. */
export function WorkflowPerformance({ rows, canCreate }: { rows: WorkflowPerformanceRow[]; canCreate: boolean }) {
  return (
    <section aria-labelledby="wf-perf-title" className="rounded-[14px] border bg-surface shadow-card">
      <header className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 id="wf-perf-title" className="text-card-title">
            Workflow performance
          </h2>
          <p className="text-xs text-text-muted">Live runs only — tests and simulations aren&apos;t counted.</p>
        </div>
        <Link href="/workflows" className="text-[13px] font-medium text-brand hover:underline">
          All workflows
        </Link>
      </header>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <Workflow className="size-8 text-text-muted" aria-hidden />
          <p className="text-[14px] font-semibold">No workflows are active yet.</p>
          <p className="text-[13px] text-text-secondary">Turn repetitive work into automation.</p>
          {canCreate && (
            <Button asChild className="mt-2">
              <Link href="/workflows/new">
                <Plus aria-hidden /> Create Workflow
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Tablet & desktop: table (scrolls horizontally on tablet if needed) */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] text-[13.5px]">
              <thead>
                <tr className="border-b text-left text-xs font-medium text-text-muted">
                  <th scope="col" className="px-5 py-2.5 font-medium">Workflow</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Employee</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Runs</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Success</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Last run</th>
                  <th scope="col" className="px-5 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-2">
                    <th scope="row" className="px-5 py-3 text-left font-medium">
                      <Link href={`/workflows/${r.id}`} className="hover:underline">
                        {r.name}
                      </Link>
                    </th>
                    <td className="px-3 py-3">
                      {r.agent ? (
                        <span className="flex items-center gap-2">
                          <AgentAvatar name={r.agent.name} color={r.agent.color} size={22} />
                          {r.agent.name}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.runs}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{pct(r.successRate)}</td>
                    <td className="px-3 py-3 text-text-secondary">{ago(r.lastRunAt)}</td>
                    <td className="px-5 py-3">
                      <WorkflowStatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile: one card per workflow — no horizontal scrolling */}
          <ul className="grid gap-3 p-4 md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/workflows/${r.id}`} className="block rounded-xl border p-4 hover:bg-surface-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold">{r.name}</p>
                    <WorkflowStatusBadge status={r.status} />
                  </div>
                  {r.agent && <p className="mt-1 text-[13px] text-text-secondary">{r.agent.name}</p>}
                  <p className="mt-2 text-[13px]">
                    {r.runs} run{r.runs === 1 ? "" : "s"} · {pct(r.successRate)} success
                  </p>
                  <p className="text-xs text-text-muted">Last run: {ago(r.lastRunAt)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
