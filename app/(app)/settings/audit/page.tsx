import type { Metadata } from "next";
import Link from "next/link";
import { format } from "date-fns";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Audit log" };

const PAGE_SIZE = 50;

export default async function AuditPage(props: PageProps<"/settings/audit">) {
  const ctx = await requirePageContext("audit:read");
  const sp = await props.searchParams;
  const cursor = typeof sp.cursor === "string" ? sp.cursor : undefined;
  const action = typeof sp.action === "string" ? sp.action.slice(0, 60) : undefined;

  const rows = await prisma.auditLog.findMany({
    where: { orgId: ctx.org.id, ...(action ? { action: { startsWith: action } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > PAGE_SIZE;
  const items = rows.slice(0, PAGE_SIZE);

  const userIds = [...new Set(items.map((r) => r.actorUserId).filter(Boolean))] as string[];
  const agentIds = [...new Set(items.map((r) => r.actorAgentId).filter(Boolean))] as string[];
  const [users, agents] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    prisma.agent.findMany({ where: { id: { in: agentIds }, orgId: ctx.org.id }, select: { id: true, name: true } }),
  ]);
  const nameOf = (r: (typeof items)[number]) =>
    r.actorUserId
      ? (users.find((u) => u.id === r.actorUserId)?.name ?? "User")
      : r.actorAgentId
        ? (agents.find((a) => a.id === r.actorAgentId)?.name ?? "AI employee")
        : r.actorType === "API_KEY"
          ? "API key"
          : "System";

  const filters = ["auth", "agent", "tool", "approval", "workflow", "member", "policy", "credential"];

  return (
    <section className="rounded-xl border bg-surface shadow-card">
      <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-card-title">Audit log</h2>
          <p className="text-[13px] text-text-secondary">Immutable record of security-relevant actions. Secrets are redacted.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button asChild size="xs" variant={!action ? "secondary" : "ghost"}>
            <Link href="/settings/audit">All</Link>
          </Button>
          {filters.map((f) => (
            <Button key={f} asChild size="xs" variant={action === f ? "secondary" : "ghost"}>
              <Link href={`/settings/audit?action=${f}`} className="capitalize">
                {f}
              </Link>
            </Button>
          ))}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-10 text-center text-[13px] text-text-muted">No audit events yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead className="bg-surface-2 text-left text-xs text-text-muted">
              <tr>
                <th className="px-5 py-2.5 font-medium">Time</th>
                <th className="px-3 py-2.5 font-medium">Actor</th>
                <th className="px-3 py-2.5 font-medium">Action</th>
                <th className="px-3 py-2.5 font-medium">Entity</th>
                <th className="px-5 py-2.5 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-5 py-2.5 text-text-muted">{format(r.createdAt, "MMM d, HH:mm:ss")}</td>
                  <td className="px-3 py-2.5">{nameOf(r)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    {r.action}
                    {r.toolKey && <span className="block text-text-muted">{r.toolKey}</span>}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-text-muted">
                    {r.entityType ? `${r.entityType} ${r.entityId ?? ""}` : "—"}
                    {r.runId && <span className="block">run {r.runId}</span>}
                  </td>
                  <td className="px-5 py-2.5">
                    <Badge
                      className={
                        r.outcome === "SUCCESS"
                          ? "bg-success-soft text-success-text"
                          : r.outcome === "DENIED"
                            ? "bg-warning-soft text-warning-text"
                            : "bg-danger-soft text-danger-text"
                      }
                    >
                      {r.outcome.toLowerCase()}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && (
        <div className="border-t px-5 py-3 text-right">
          <Button asChild variant="outline" size="sm">
            <Link href={`/settings/audit?cursor=${items[items.length - 1].id}${action ? `&action=${action}` : ""}`}>Older events</Link>
          </Button>
        </div>
      )}
    </section>
  );
}
