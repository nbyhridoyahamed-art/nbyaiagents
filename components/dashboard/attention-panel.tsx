import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { AlertOctagon, CheckCircle2, ChevronRight, FileCheck, HelpCircle, Plug, ShieldCheck, TextCursorInput } from "lucide-react";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import type { AttentionItem, DashboardSummary } from "@/server/services/dashboard";
import { cn } from "@/lib/utils";

const KIND_STYLE: Record<AttentionItem["kind"], { icon: typeof HelpCircle; tone: string }> = {
  approval: { icon: ShieldCheck, tone: "bg-warning-soft text-warning-text" },
  review: { icon: FileCheck, tone: "bg-warning-soft text-warning-text" },
  question: { icon: HelpCircle, tone: "bg-info-soft text-info-text" },
  input: { icon: TextCursorInput, tone: "bg-info-soft text-info-text" },
  escalation: { icon: AlertOctagon, tone: "bg-danger-soft text-danger-text" },
  integration: { icon: Plug, tone: "bg-danger-soft text-danger-text" },
};

function headline(a: DashboardSummary["attention"]) {
  const other = a.questions + a.integrations;
  if (a.total === 0) return "Nothing needs you right now.";
  const parts = [a.approvals > 0 && `${a.approvals} approval${a.approvals === 1 ? "" : "s"}`, other > 0 && `${other} item${other === 1 ? "" : "s"}`].filter(Boolean);
  return `${parts.join(" and ")} need${a.total === 1 ? "s" : ""} review.`;
}

/** "Needs your attention" (spec §86): approvals, questions and broken integrations. */
export function AttentionPanel({ items, attention }: { items: AttentionItem[]; attention: DashboardSummary["attention"] }) {
  return (
    <section aria-labelledby="attention-title" className="flex h-full flex-col rounded-[14px] border bg-surface shadow-card">
      <header className="border-b px-5 py-4">
        <h2 id="attention-title" className="text-eyebrow text-warning-text">
          Needs your attention
        </h2>
        <p className="mt-1 text-[14px] font-medium">{headline(attention)}</p>
      </header>
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center">
          <CheckCircle2 className="size-8 text-success" aria-hidden />
          <p className="text-[13.5px] font-medium">You&apos;re all caught up</p>
          <p className="max-w-[240px] text-xs text-text-muted">Approvals, questions and integration problems will appear here.</p>
        </div>
      ) : (
        <ul className="flex-1 divide-y">
          {items.map((it) => {
            const style = KIND_STYLE[it.kind];
            const Icon = style.icon;
            return (
              <li key={it.id}>
                <Link href={it.href} className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">
                  {it.who.color ? (
                    <AgentAvatar name={it.who.name} color={it.who.color} size={32} />
                  ) : (
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", style.tone)}>
                      <Icon className="size-4" aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold">{it.who.name}</span>
                    <span className="line-clamp-2 block text-[13px] text-text-secondary">{it.title}</span>
                    <span className="mt-1 flex items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", style.tone)}>
                        <Icon className="size-3" aria-hidden /> {it.label}
                      </span>
                      <span className="text-[11.5px] text-text-muted">{formatDistanceToNow(new Date(it.at), { addSuffix: true })}</span>
                    </span>
                  </span>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-text-muted" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {attention.total > items.length && (
        <footer className="border-t px-5 py-3 text-[13px]">
          <Link href="/approvals" className="font-medium text-brand hover:underline">
            View all {attention.total}
          </Link>
        </footer>
      )}
    </section>
  );
}
