import type { Metadata } from "next";
import { format } from "date-fns";
import { listOrganizationsForAdmin } from "@/server/services/admin";
import { formatUsd } from "@/lib/format";
import { OrgActions } from "./org-actions";

export const metadata: Metadata = { title: "Organizations" };

export default async function AdminOrganizationsPage(props: PageProps<"/admin/organizations">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : undefined;
  const orgs = await listOrganizationsForAdmin(q);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-page-title">Organizations</h1>
        <form role="search">
          <input name="q" defaultValue={q} placeholder="Search name or slug" aria-label="Search organizations" className="h-9 w-64 rounded-lg border bg-surface px-3 text-[13px]" />
        </form>
      </div>
      <div className="overflow-x-auto rounded-[14px] border bg-surface shadow-card">
        <table className="w-full min-w-[980px] text-[13px]">
          <thead>
            <tr className="border-b text-left text-xs text-text-muted">
              {["Company", "Plan", "Members", "Employees", "Workflows", "Runs 30d", "AI cost 30d", "Created", "Status", ""].map((h, i) => (
                <th key={i} scope="col" className="px-4 py-2.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {orgs.map((o) => (
              <tr key={o.id}>
                <th scope="row" className="px-4 py-3 text-left font-medium">
                  {o.name}
                  <span className="block font-mono text-[11px] font-normal text-text-muted">
                    {o.slug}
                    {o.isDemo ? " · demo" : ""}
                  </span>
                </th>
                <td className="px-4 py-3 capitalize">{o.plan.toLowerCase()}</td>
                <td className="px-4 py-3 tabular-nums">{o.members}</td>
                <td className="px-4 py-3 tabular-nums">{o.agents}</td>
                <td className="px-4 py-3 tabular-nums">{o.workflows}</td>
                <td className="px-4 py-3 tabular-nums">{o.runs30d}</td>
                <td className="px-4 py-3 tabular-nums">{formatUsd(o.cost30d)}</td>
                <td className="px-4 py-3 text-text-secondary">{format(new Date(o.createdAt), "PP")}</td>
                <td className="px-4 py-3">
                  {o.suspendedAt ? (
                    <span className="rounded bg-danger-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-danger-text" title={o.suspendedReason ?? undefined}>
                      Suspended
                    </span>
                  ) : (
                    <span className="rounded bg-success-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-success-text">Active</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <OrgActions org={{ id: o.id, name: o.name, plan: o.plan, suspended: !!o.suspendedAt }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {orgs.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-text-muted">No organizations match.</p>}
      </div>
    </div>
  );
}
