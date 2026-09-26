import Link from "next/link";
import { BookOpen, Plug, Users, Workflow } from "lucide-react";
import type { CompanyHealth } from "@/server/services/dashboard";
import { cn } from "@/lib/utils";

function Row({ icon: Icon, label, value, ok, href }: { icon: typeof Users; label: string; value: string; ok: boolean | null; href: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
        <Icon className="size-4 shrink-0 text-text-muted" aria-hidden />
        <span className="flex-1 text-[13.5px]">{label}</span>
        <span className="text-[13.5px] font-semibold tabular-nums">{value}</span>
        {ok !== null && (
          <span className={cn("size-2 rounded-full", ok ? "bg-success" : "bg-warning")} aria-label={ok ? "healthy" : "needs attention"} role="img" />
        )}
      </Link>
    </li>
  );
}

/** Company health (spec §58, §89). Usage is the measured AI cost this month against the company budget. */
export function HealthCard({ health, canManageBudget }: { health: CompanyHealth; canManageBudget: boolean }) {
  const { employees, workflows, integrations, knowledge, usage } = health;
  const usageTone = usage.percent >= 90 ? "bg-danger" : usage.percent >= 70 ? "bg-warning" : "bg-brand";
  return (
    <section aria-labelledby="health-title" className="flex h-full flex-col rounded-[14px] border bg-surface p-5 shadow-card">
      <h2 id="health-title" className="text-eyebrow text-text-secondary">
        Company health
      </h2>
      <ul className="-mx-2 mt-3 grid gap-0.5">
        <Row icon={Users} label="Employees" value={employees.total ? `${employees.healthy} / ${employees.total} healthy` : "none yet"} ok={employees.total ? employees.healthy === employees.total : null} href="/agents" />
        <Row icon={Workflow} label="Workflows" value={workflows.total ? `${workflows.active} / ${workflows.total} active` : "none published"} ok={workflows.total ? workflows.active === workflows.total : null} href="/workflows" />
        <Row
          icon={Plug}
          label="Integrations"
          value={integrations.total ? `${integrations.connected} / ${integrations.total} connected` : "none connected"}
          ok={integrations.total ? integrations.connected === integrations.total : null}
          href="/integrations"
        />
        <Row icon={BookOpen} label="Knowledge" value={knowledge.percent !== null ? `${knowledge.percent}% indexed` : "no documents"} ok={knowledge.percent !== null ? knowledge.percent === 100 : null} href="/knowledge" />
      </ul>
      <div className="mt-auto border-t pt-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[13px] font-medium text-text-secondary">AI usage this month</p>
          <p className="text-kpi text-[22px]">{usage.percent}%</p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={usage.percent} aria-valuemin={0} aria-valuemax={100} aria-label="AI usage of monthly budget">
          <div className={cn("h-full rounded-full", usageTone)} style={{ width: `${usage.percent}%` }} />
        </div>
        <p className="mt-2 text-xs text-text-muted">
          ${usage.spentUsd.toFixed(2)} / ${usage.budgetUsd.toFixed(0)} estimated monthly budget
          {canManageBudget && (
            <>
              {" · "}
              <Link href="/settings/company" className="text-brand hover:underline">
                Change budget
              </Link>
            </>
          )}
        </p>
      </div>
    </section>
  );
}
