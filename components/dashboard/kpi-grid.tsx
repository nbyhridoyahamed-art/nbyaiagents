import Link from "next/link";
import { BellRing, CheckCircle2, Loader, Users, type LucideIcon } from "lucide-react";
import type { DashboardSummary } from "@/server/services/dashboard";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

function Kpi({ label, value, detail, icon: Icon, tone, href, index }: { label: string; value: number; detail: string; icon: LucideIcon; tone: string; href: string; index: number }) {
  return (
    <Reveal index={index}>
      <Link
        href={href}
        className="group flex h-[128px] flex-col justify-between rounded-[14px] border bg-surface p-4 shadow-card transition-all duration-[160ms] hover:-translate-y-px hover:border-border-strong hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:p-5"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-[12.5px] font-medium leading-tight text-text-secondary md:text-[13px]">{label}</p>
          <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg md:size-8", tone)}>
            <Icon className="size-4" aria-hidden />
          </span>
        </div>
        <div>
          <p className="text-kpi">{pad(value)}</p>
          <p className="truncate text-xs text-text-muted">{detail}</p>
        </div>
      </Link>
    </Reveal>
  );
}

/** Four KPIs (spec §78–79), all measured. "Today" is the company's calendar day. */
export function KpiGrid({ summary }: { summary: DashboardSummary }) {
  const { agents, tasks, attention } = summary;
  const agentDetail = [agents.working > 0 && `${agents.working} working`, agents.scheduled > 0 && `${agents.scheduled} scheduled`].filter(Boolean).join(" · ") || (agents.total ? "all idle" : "none hired yet");
  const attentionDetail =
    [attention.approvals > 0 && `${attention.approvals} approval${attention.approvals === 1 ? "" : "s"}`, attention.questions > 0 && `${attention.questions} question${attention.questions === 1 ? "" : "s"}`, attention.integrations > 0 && `${attention.integrations} integration${attention.integrations === 1 ? "" : "s"}`]
      .filter(Boolean)
      .join(" · ") || "nothing waiting";
  return (
    <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
      <Kpi index={0} label="AI Employees" value={agents.total} detail={agentDetail} icon={Users} tone="bg-brand-soft text-brand" href="/agents" />
      <Kpi index={1} label="Tasks Running" value={tasks.running} detail={`${tasks.startedToday} started today`} icon={Loader} tone="bg-info-soft text-info-text" href="/tasks?filter=active" />
      <Kpi
        index={2}
        label="Needs Attention"
        value={attention.total}
        detail={attentionDetail}
        icon={BellRing}
        tone={attention.total > 0 ? "bg-warning-soft text-warning-text" : "bg-surface-2 text-text-muted"}
        href={attention.approvals > 0 ? "/approvals" : "/inbox"}
      />
      <Kpi
        index={3}
        label="Completed Today"
        value={tasks.completedToday}
        detail={tasks.successRateToday !== null ? `${tasks.successRateToday}% successful` : "no finished tasks yet"}
        icon={CheckCircle2}
        tone="bg-success-soft text-success-text"
        href="/tasks?filter=completed"
      />
    </section>
  );
}
