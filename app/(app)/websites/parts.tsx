import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Section } from "@/server/services/website-reports";

/** Card chrome shared by the Websites pages (same look as the Analytics page). */
export function Card({ title, description, actions, children, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-[14px] border bg-surface shadow-card", className)}>
      <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-card-title">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Change against the previous period. `lowerIsBetter` flips the colour (average position). */
export function Delta({ now, before, lowerIsBetter = false, unit }: { now: number; before: number; lowerIsBetter?: boolean; unit?: "percent-points" }) {
  if (!before && !now) return <span className="text-xs text-text-muted">no data yet</span>;
  if (!before) return <span className="text-xs text-text-muted">no earlier data</span>;
  const change = unit === "percent-points" ? (now - before) * 100 : ((now - before) / before) * 100;
  const rounded = Math.round(change * 10) / 10;
  const good = lowerIsBetter ? rounded <= 0 : rounded >= 0;
  const label = unit === "percent-points" ? `${rounded > 0 ? "+" : ""}${rounded} pts` : `${rounded > 0 ? "+" : ""}${rounded}%`;
  return <span className={cn("text-xs font-medium", rounded === 0 ? "text-text-muted" : good ? "text-success-text" : "text-danger-text")}>{label} vs previous period</span>;
}

export function Kpi({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="rounded-[14px] border bg-surface p-4 shadow-card">
      <p className="text-[13px] font-medium text-text-secondary">{label}</p>
      <p className="mt-2 text-kpi">{value}</p>
      <div className="mt-1 min-h-4">{children}</div>
    </div>
  );
}

/** "https://shop.example.com/a/b?x=1" → "/a/b?x=1" (the host is already known from the website). */
export function shortUrl(value: string): string {
  try {
    const u = new URL(value);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return value || "(not set)";
  }
}

export interface BreakdownItem {
  key: string;
  value: number;
  detail?: string;
}

/** A ranked list with a proportional bar behind each row. */
export function Breakdown({ items, valueLabel, empty = "No data in this period.", mono = false }: { items: BreakdownItem[]; valueLabel: string; empty?: string; mono?: boolean }) {
  if (!items.length) return <p className="py-4 text-center text-[13px] text-text-muted">{empty}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-text-muted">
        <span>&nbsp;</span>
        <span>{valueLabel}</span>
      </div>
      <ul className="grid gap-1.5">
        {items.map((item, index) => (
          <li key={`${index}-${item.key}`} className="relative overflow-hidden rounded-md">
            <span aria-hidden className="absolute inset-y-0 left-0 rounded-md bg-brand-soft" style={{ width: `${Math.max(2, Math.round((item.value / max) * 100))}%` }} />
            <div className="relative flex items-center justify-between gap-3 px-2.5 py-1.5 text-[13px]">
              <span className={cn("min-w-0 truncate", mono && "font-mono text-[12.5px]")} title={item.key}>
                {item.key || "(not set)"}
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="font-medium">{formatNumber(item.value)}</span>
                {item.detail && <span className="ml-2 text-xs text-text-secondary">{item.detail}</span>}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What to show in place of a report: not linked, Google not connected, or an error.
 * Returns null when the data is ready. `changeHref` opens the property picker.
 */
export function SectionNotice<T>({ section, product, changeHref, canManage }: { section: Section<T>; product: string; changeHref: string; canManage: boolean }) {
  if (section.status === "ok") return null;
  if (section.status === "unlinked") {
    return (
      <Card title={`${product} isn't linked to this website yet`}>
        <p className="text-[13px] text-text-secondary">Choose which {product} property measures this site and its numbers will show up here.</p>
        {canManage && (
          <Button asChild size="sm" className="mt-3">
            <Link href={changeHref}>Link {product}</Link>
          </Button>
        )}
      </Card>
    );
  }
  const notConnected = section.status === "not_connected";
  const needsIntegrations = notConnected || /reconnect/i.test(section.message);
  return (
    <Card title={notConnected ? "Google isn't connected" : `Couldn't load ${product}`}>
      <div className="flex items-start gap-3 text-[13px] text-text-secondary">
        {notConnected ? <Plug className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />}
        <div>
          <p>{section.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {needsIntegrations && (
              <Button asChild size="sm" variant="outline">
                <Link href="/integrations">Open Integrations</Link>
              </Button>
            )}
            {!notConnected && canManage && (
              <Button asChild size="sm" variant="outline">
                <Link href={changeHref}>Choose another property</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** "Last 7 / 28 / 90 days" switcher, as links so the choice survives a refresh or share. */
export function RangeNav({ days, options, href }: { days: number; options: readonly number[]; href: (days: number) => string }) {
  return (
    <nav aria-label="Date range" className="inline-flex rounded-xl border bg-surface p-1">
      {options.map((d) => (
        <Link key={d} href={href(d)} scroll={false} aria-current={d === days ? "page" : undefined} className={cn("rounded-lg px-3 py-1 text-[13px] font-medium", d === days ? "bg-brand-soft text-brand-hover" : "text-text-secondary hover:bg-surface-2")}>
          {d} days
        </Link>
      ))}
    </nav>
  );
}
