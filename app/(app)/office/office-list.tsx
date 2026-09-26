import Link from "next/link";
import { STATUS_META } from "@/components/agents/status-meta";
import type { OfficeData } from "@/server/services/office";

/**
 * The same map as structured text: readable by screen readers, on small screens
 * and without JavaScript. Collapsed by default so the visual stays the focus.
 */
export function OfficeList({ data }: { data: OfficeData }) {
  const name = (id: string) => data.agents.find((a) => a.id === id)?.name ?? "Unknown";
  return (
    <details className="mt-4 rounded-[14px] border bg-surface shadow-card">
      <summary className="cursor-pointer select-none px-5 py-3.5 text-[13.5px] font-medium">Show the office as a list</summary>
      <div className="grid gap-6 border-t px-5 py-4 md:grid-cols-2">
        <section aria-labelledby="office-list-rooms">
          <h2 id="office-list-rooms" className="text-card-title">
            Departments
          </h2>
          <ul className="mt-2 grid gap-3">
            {data.rooms.map((r) => (
              <li key={r.id}>
                <p className="text-[13px] font-semibold">{r.name}</p>
                <ul className="mt-1 grid gap-1 pl-3">
                  {r.agentIds.map((id) => {
                    const a = data.agents.find((x) => x.id === id)!;
                    return (
                      <li key={id} className="text-[13px]">
                        <Link href={`/agents/${a.id}`} className="font-medium text-brand hover:underline">
                          {a.name}
                        </Link>{" "}
                        <span className="text-text-muted">
                          — {a.jobTitle}, {STATUS_META[a.status].label.toLowerCase()}
                          {a.activity ? `: ${a.activity}` : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </section>
        <div className="grid content-start gap-6">
          <section aria-labelledby="office-list-delegation">
            <h2 id="office-list-delegation" className="text-card-title">
              Delegation
            </h2>
            {data.delegations.length === 0 ? (
              <p className="mt-2 text-[13px] text-text-muted">No employee hands work to another yet.</p>
            ) : (
              <ul className="mt-2 grid gap-1 text-[13px]">
                {data.delegations.map((d) => (
                  <li key={d.id}>
                    {name(d.from)} can hand work to {name(d.to)}
                    <span className="text-text-muted">{d.activeRuns ? ` · ${d.activeRuns} handoff${d.activeRuns === 1 ? "" : "s"} in progress` : d.recentRuns ? ` · ${d.recentRuns} in the last 30 days` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="office-list-workflows">
            <h2 id="office-list-workflows" className="text-card-title">
              Workflows
            </h2>
            {data.workflows.length === 0 ? (
              <p className="mt-2 text-[13px] text-text-muted">No workflows yet.</p>
            ) : (
              <ul className="mt-2 grid gap-1 text-[13px]">
                {data.workflows.map((w) => (
                  <li key={w.id}>
                    <Link href={`/workflows/${w.id}`} className="font-medium text-brand hover:underline">
                      {w.name}
                    </Link>{" "}
                    <span className="text-text-muted">
                      — {w.status.toLowerCase()}
                      {w.agentIds.length ? `, involves ${w.agentIds.map(name).join(", ")}` : ""}
                      {w.activeRuns ? `, ${w.activeRuns} running now` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </details>
  );
}
