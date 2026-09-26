import type { Metadata } from "next";
import { formatDistanceToNow } from "date-fns";
import { getPlatformErrors } from "@/server/services/admin";

export const metadata: Metadata = { title: "Errors" };

export default async function AdminErrorsPage() {
  const errors = await getPlatformErrors();
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-page-title">Errors</h1>
        <p className="text-[13px] text-text-secondary">Failed employee runs and workflow runs from the last 7 days, and background jobs that failed or gave up, across all companies.</p>
      </div>
      <div className="rounded-[14px] border bg-surface shadow-card">
        {errors.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-text-muted">No errors. Nice.</p>
        ) : (
          <ul className="divide-y">
            {errors.map((e) => (
              <li key={`${e.source}-${e.id}`} className="grid gap-1 px-5 py-3 text-[13px] md:grid-cols-[150px_180px_minmax(0,1fr)_120px] md:gap-4">
                <span className="text-xs font-medium text-text-muted">
                  {e.source}
                  {e.simulation && " · test"}
                </span>
                <span className="truncate">
                  <span className="font-medium">{e.org}</span>
                  <span className="block truncate text-xs text-text-muted">{e.subject}</span>
                </span>
                <span className="min-w-0 break-words text-text-secondary">{e.message}</span>
                <span className="text-xs text-text-muted md:text-right">
                  {formatDistanceToNow(new Date(e.at), { addSuffix: true })}
                  <span className="block font-mono text-[10.5px]">{e.id}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
