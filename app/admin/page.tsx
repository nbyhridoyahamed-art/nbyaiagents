import Link from "next/link";
import { getAdminOverview, getSystemHealth } from "@/server/services/admin";
import { formatNumber, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export default async function AdminOverviewPage() {
  const [o, health] = await Promise.all([getAdminOverview(), getSystemHealth()]);
  const tiles: [string, string, string, string][] = [
    ["Organizations", formatNumber(o.orgs), `${o.newOrgs7d} new this week · ${o.suspended} suspended`, "/admin/organizations"],
    ["Users", formatNumber(o.users), `${o.disabled} disabled`, "/admin/users"],
    ["AI employees", formatNumber(o.agents), "across all companies", "/admin/usage"],
    ["Workflow runs", formatNumber(o.runs24h), `last 24h · ${formatNumber(o.runs30d)} in 30 days`, "/admin/usage"],
    ["Est. AI cost", formatUsd(o.cost30d), "last 30 days", "/admin/usage"],
    ["Errors", formatNumber(o.errors24h), "failed runs and jobs, last 24h", "/admin/errors"],
  ];
  const healthy = health.database.ok && health.queue.workerOk && health.queue.dead === 0;
  const problems = [!health.database.ok && "database unreachable", !health.queue.workerOk && "job backlog (is the worker running?)", health.queue.dead > 0 && `${health.queue.dead} dead jobs`].filter(Boolean);
  return (
    <div className="grid gap-6">
      <h1 className="text-page-title">Overview</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        {tiles.map(([label, value, detail, href]) => (
          <Link key={label} href={href} className="rounded-[14px] border bg-surface p-4 shadow-card hover:border-border-strong">
            <p className="text-[13px] text-text-secondary">{label}</p>
            <p className="mt-2 text-kpi">{value}</p>
            <p className="mt-1 text-xs text-text-muted">{detail}</p>
          </Link>
        ))}
      </div>
      <Link
        href="/admin/health"
        className={cn("rounded-[14px] border p-4 text-[13.5px] shadow-card", healthy ? "border-success/30 bg-success-soft text-success-text" : "border-warning/40 bg-warning-soft text-warning-text")}
      >
        {healthy ? `All systems normal · database ${health.database.latencyMs} ms · ${health.queue.pending} jobs waiting` : `Needs attention: ${problems.join(" · ")}`}
      </Link>
    </div>
  );
}
