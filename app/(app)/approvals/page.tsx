import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, History, Settings2 } from "lucide-react";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import type { RiskLevel } from "@/lib/generated/prisma/enums";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { EmptyState } from "@/components/common/empty-state";
import { ScrollToId } from "@/components/common/scroll-to-id";
import { Button } from "@/components/ui/button";
import { ApprovalCard } from "@/components/approvals/approval-card";
import { approvalCounts, listApprovalCards } from "@/server/services/approval-queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Approvals" };

const RISKS: RiskLevel[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export default async function ApprovalsPage(props: PageProps<"/approvals">) {
  const ctx = await requirePageContext("approvals:read");
  const sp = await props.searchParams;
  const view = sp.view === "history" ? "history" : "pending";
  const agentId = typeof sp.agent === "string" ? sp.agent : undefined;
  const risk = RISKS.includes(sp.risk as RiskLevel) ? (sp.risk as RiskLevel) : undefined;
  const focus = typeof sp.focus === "string" ? sp.focus : undefined;

  const [cards, counts, agents] = await Promise.all([
    listApprovalCards(ctx.org.id, { scope: "actions", view, agentId, risk }),
    approvalCounts(ctx.org.id),
    prisma.agent.findMany({ where: { orgId: ctx.org.id, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  // A focused approval that's already decided (e.g. from an old notification) should still be findable.
  const focusMissing = focus && !cards.some((c) => c.id === focus);
  const focusedCard = focusMissing ? (await listApprovalCards(ctx.org.id, { scope: "actions", view: view === "pending" ? "history" : "pending" }, 200)).find((c) => c.id === focus) : undefined;

  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = { view, agent: agentId, risk, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "view" && v === "pending")) q.set(k, v);
    const s = q.toString();
    return `/approvals${s ? `?${s}` : ""}`;
  };
  const canDecide = ctx.can("approvals:decide");

  return (
    <PageContainer>
      <PageHeader
        title="Approvals"
        description="Actions your AI employees want to take that need a human decision. Nothing happens until you approve — and you can edit before approving."
        actions={
          ctx.can("policies:manage") && (
            <Button asChild variant="outline">
              <Link href="/settings/policies#approval-rules">
                <Settings2 aria-hidden /> Approval rules
              </Link>
            </Button>
          )
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <nav aria-label="Approval views" className="flex gap-1.5">
          {[
            { key: "pending", label: "Waiting", count: counts.actions },
            { key: "history", label: "Decided" },
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
        <nav aria-label="Filter by risk" className="flex flex-wrap gap-1.5">
          <FilterChip href={href({ risk: undefined })} active={!risk}>
            Any risk
          </FilterChip>
          {RISKS.map((r) => (
            <FilterChip key={r} href={href({ risk: r })} active={risk === r}>
              {r.charAt(0) + r.slice(1).toLowerCase()}
            </FilterChip>
          ))}
        </nav>
        {agents.length > 0 && (
          <nav aria-label="Filter by employee" className="flex flex-wrap gap-1.5">
            <FilterChip href={href({ agent: undefined })} active={!agentId}>
              All employees
            </FilterChip>
            {agents.slice(0, 8).map((a) => (
              <FilterChip key={a.id} href={href({ agent: a.id })} active={agentId === a.id}>
                {a.name}
              </FilterChip>
            ))}
          </nav>
        )}
      </div>

      {focus && <ScrollToId id={`approval-${focus}`} />}
      {focusedCard && (
        <div className="mb-6">
          <p className="mb-2 text-xs font-medium text-text-muted">The request you opened</p>
          <ApprovalCard card={focusedCard} canDecide={canDecide} focused />
        </div>
      )}

      {cards.length === 0 ? (
        <EmptyState
          icon={view === "pending" ? CheckCircle2 : History}
          title={view === "pending" ? "You're all caught up" : "No decisions yet"}
          description={
            view === "pending"
              ? "When an employee wants to do something that needs approval — like sending an email or deleting data — it will wait here for you."
              : "Approved and rejected actions will be listed here for reference."
          }
        />
      ) : (
        <div className="grid max-w-3xl gap-4">
          {cards.map((c) => (
            <ApprovalCard key={c.id} card={c} canDecide={canDecide} focused={c.id === focus} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn("rounded-full px-2.5 py-1 text-[12.5px]", active ? "bg-foreground text-background" : "text-text-secondary hover:bg-surface-2")}
    >
      {children}
    </Link>
  );
}
