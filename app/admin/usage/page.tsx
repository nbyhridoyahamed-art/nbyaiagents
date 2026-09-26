import type { Metadata } from "next";
import { getUsageReport } from "@/server/services/admin";
import { formatNumber, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Usage" };

function Metered({ m }: { m: { used: number; limit: number | null; pct: number | null } }) {
  return (
    <div className="min-w-[110px]">
      <span className="tabular-nums">{formatNumber(m.used)}</span>
      <span className="text-text-muted"> / {m.limit === null ? "∞" : formatNumber(m.limit)}</span>
      {m.pct !== null && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
          <div className={cn("h-full rounded-full", m.pct >= 90 ? "bg-danger" : m.pct >= 70 ? "bg-warning" : "bg-brand")} style={{ width: `${m.pct}%` }} />
        </div>
      )}
    </div>
  );
}

export default async function AdminUsagePage() {
  const rows = await getUsageReport();
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-page-title">Usage</h1>
        <p className="text-[13px] text-text-secondary">This calendar month (UTC), measured from usage records, against each company&apos;s plan entitlements. No payment provider is involved.</p>
      </div>
      <div className="overflow-x-auto rounded-[14px] border bg-surface shadow-card">
        <table className="w-full min-w-[1100px] text-[13px]">
          <thead>
            <tr className="border-b text-left text-xs text-text-muted">
              {["Company", "Plan", "Employees", "Members", "AI calls", "Tokens", "Est. cost", "Tool calls", "Workflow runs", "Storage (MB)", "API requests"].map((h) => (
                <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <th scope="row" className="px-4 py-3 text-left font-medium">
                  {r.name}
                </th>
                <td className="px-4 py-3 capitalize">{r.plan.toLowerCase()}</td>
                <td className="px-4 py-3">
                  <Metered m={r.agents} />
                </td>
                <td className="px-4 py-3">
                  <Metered m={r.members} />
                </td>
                <td className="px-4 py-3">
                  <Metered m={r.aiCalls} />
                </td>
                <td className="px-4 py-3 tabular-nums">{formatNumber(r.tokens)}</td>
                <td className="px-4 py-3 tabular-nums">{formatUsd(r.costUsd)}</td>
                <td className="px-4 py-3 tabular-nums">{formatNumber(r.toolCalls)}</td>
                <td className="px-4 py-3">
                  <Metered m={r.workflowRuns} />
                </td>
                <td className="px-4 py-3">
                  <Metered m={r.storageMb} />
                </td>
                <td className="px-4 py-3">
                  <Metered m={r.apiRequests} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
