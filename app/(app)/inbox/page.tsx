import type { Metadata } from "next";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Hand, History, Inbox } from "lucide-react";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import type { ApprovalKind } from "@/lib/generated/prisma/enums";
import { PageContainer, PageHeader, SectionHeader } from "@/components/layout/page";
import { EmptyState } from "@/components/common/empty-state";
import { RequestCard } from "@/components/approvals/request-card";
import { listApprovalCards } from "@/server/services/approval-queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Inbox" };

const KINDS: { key: string; label: string; kind?: ApprovalKind }[] = [
  { key: "all", label: "Everything" },
  { key: "questions", label: "Questions", kind: "QUESTION" },
  { key: "input", label: "Input requests", kind: "INPUT_REQUEST" },
  { key: "escalations", label: "Escalations", kind: "ESCALATION" },
];

export default async function InboxPage(props: PageProps<"/inbox">) {
  const ctx = await requirePageContext("approvals:read");
  const sp = await props.searchParams;
  const view = sp.view === "history" ? "history" : "pending";
  const kindFilter = KINDS.find((k) => k.key === sp.kind) ?? KINDS[0];

  const [cards, myTasks, grouped] = await Promise.all([
    listApprovalCards(ctx.org.id, { scope: "requests", view, kind: kindFilter.kind }),
    prisma.task.findMany({
      where: { orgId: ctx.org.id, assigneeUserId: ctx.user.id, deletedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] } },
      orderBy: { takenOverAt: "desc" },
      include: { agent: { select: { name: true } } },
      take: 20,
    }),
    prisma.approval.groupBy({ by: ["kind"], where: { orgId: ctx.org.id, status: "PENDING", kind: { in: ["QUESTION", "INPUT_REQUEST", "ESCALATION"] } }, _count: true }),
  ]);
  const countFor = (kind?: ApprovalKind) => grouped.filter((g) => !kind || g.kind === kind).reduce((s, g) => s + g._count, 0);
  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = { view, kind: kindFilter.key, ...patch };
    if (merged.view === "history") q.set("view", "history");
    if (merged.kind && merged.kind !== "all") q.set("kind", merged.kind);
    const s = q.toString();
    return `/inbox${s ? `?${s}` : ""}`;
  };

  return (
    <PageContainer>
      <PageHeader title="Inbox" description="Questions, requests for information and escalations from your AI employees and workflows. Answer here and the paused work picks up where it left off." />

      {myTasks.length > 0 && view === "pending" && (
        <section className="mb-8" aria-labelledby="my-tasks">
          <SectionHeader id="my-tasks" title="Tasks you took over" description="You're responsible for finishing these. Complete them yourself or hand them back with guidance." />
          <ul className="mt-3 grid max-w-3xl gap-2">
            {myTasks.map((t) => (
              <li key={t.id}>
                <Link href={`/tasks/${t.id}`} className="flex items-center gap-3 rounded-xl border bg-surface px-4 py-3 shadow-card hover:bg-surface-2">
                  <Hand className="size-4 shrink-0 text-warning-text" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{t.title}</span>
                    <span className="block text-xs text-text-muted">
                      {t.agent ? `From ${t.agent.name} · ` : ""}taken over {t.takenOverAt ? formatDistanceToNow(t.takenOverAt, { addSuffix: true }) : ""}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <nav aria-label="Inbox views" className="flex gap-1.5">
          {[
            { key: "pending", label: "Open", count: countFor() },
            { key: "history", label: "Handled" },
          ].map((t) => (
            <Link
              key={t.key}
              href={href({ view: t.key })}
              aria-current={view === t.key ? "page" : undefined}
              className={cn("rounded-full border px-3 py-1 text-[13px] font-medium", view === t.key ? "border-brand bg-brand-soft text-brand-hover" : "text-text-secondary hover:bg-surface-2")}
            >
              {t.label} {t.count !== undefined && <span className="text-text-muted">{t.count}</span>}
            </Link>
          ))}
        </nav>
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
        <nav aria-label="Filter by type" className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <Link
              key={k.key}
              href={href({ kind: k.key })}
              aria-current={kindFilter.key === k.key ? "true" : undefined}
              className={cn("rounded-full px-2.5 py-1 text-[12.5px]", kindFilter.key === k.key ? "bg-foreground text-background" : "text-text-secondary hover:bg-surface-2")}
            >
              {k.label}
              {view === "pending" && k.kind && countFor(k.kind) > 0 && <span className="ml-1 opacity-70">{countFor(k.kind)}</span>}
            </Link>
          ))}
        </nav>
      </div>

      {cards.length === 0 ? (
        <EmptyState
          icon={view === "pending" ? Inbox : History}
          title={view === "pending" ? "Nothing needs your input" : "Nothing handled yet"}
          description={
            view === "pending"
              ? "When an employee is missing information, isn't confident enough, or hits a problem it can't solve, it asks here instead of guessing."
              : "Answered and dismissed requests will be listed here."
          }
        />
      ) : (
        <div className="grid max-w-3xl gap-4">
          {cards.map((c) => (
            <RequestCard key={c.id} card={c} canDecide={ctx.can("approvals:decide")} canTakeOver={ctx.can("tasks:write")} canRun={ctx.can("workflows:run")} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
