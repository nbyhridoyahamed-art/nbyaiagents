import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { BarChart3, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskStatusBadge } from "@/components/tasks/task-status";
import type { Website } from "@/lib/generated/prisma/client";
import { formatNumber, formatPercent } from "@/lib/format";
import { auditCandidates, listSiteAudits, analyticsOptions, searchConsoleOptions } from "@/server/services/websites";
import {
  REPORT_DAYS,
  getAnalyticsReport,
  getAnalyticsSummary,
  getSearchConsoleReport,
  getSearchConsoleSummary,
  loadSection,
} from "@/server/services/website-reports";
import { SearchTrendChart, TrafficTrendChart } from "../charts-loader";
import { PropertyPicker, type PickerOption } from "../property-picker";
import { DeleteWebsiteButton, RunAudit, UnlinkButton } from "../site-controls";
import { Breakdown, Card, Delta, Kpi, RangeNav, SectionNotice, shortUrl } from "../parts";

export interface TabProps {
  site: Website;
  orgId: string;
  canManage: boolean;
  canRunAudit: boolean;
  days: number;
  changing: boolean;
  href: (patch: Record<string, string | null>) => string;
}

const pct = (ctr: number) => formatPercent(Math.round(ctr * 1000) / 10);

// ── Overview ─────────────────────────────────────────────────────────────

function LinkedRow({ product, value, detail, kind, changeHref, site, canManage }: { product: string; value: string | null; detail?: string | null; kind: "search_console" | "analytics"; changeHref: string; site: Website; canManage: boolean }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{product}</p>
        {value ? (
          <p className="truncate text-[13px] text-text-secondary" title={value}>
            {detail ? `${detail} · ` : ""}
            {value}
          </p>
        ) : (
          <p className="text-[13px] text-text-muted">Not linked</p>
        )}
      </div>
      {canManage && (
        <div className="flex items-center gap-1">
          <Button asChild size="sm" variant={value ? "ghost" : "outline"}>
            <Link href={changeHref}>{value ? "Change" : `Link ${product}`}</Link>
          </Button>
          {value && <UnlinkButton websiteId={site.id} kind={kind} product={product} />}
        </div>
      )}
    </li>
  );
}

export async function OverviewTab({ site, orgId, canManage, days, href }: TabProps) {
  const [gsc, ga, audits] = await Promise.all([
    getSearchConsoleSummary(orgId, site.gscSiteUrl, days),
    getAnalyticsSummary(orgId, site.gaProperty, days),
    listSiteAudits(orgId, site.id),
  ]);
  const latest = audits[0];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-text-secondary">Headline numbers for the last {days} days.</p>
        <RangeNav days={days} options={REPORT_DAYS} href={(d) => href({ days: d === 28 ? null : String(d) })} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="grid gap-3">
          <h2 className="flex items-center gap-2 text-section-title">
            <Search className="size-4 text-text-muted" aria-hidden /> Search performance
          </h2>
          {gsc.status === "ok" ? (
            <div className="grid grid-cols-3 gap-3">
              <Kpi label="Clicks" value={formatNumber(gsc.data.totals.clicks)}>
                <Delta now={gsc.data.totals.clicks} before={gsc.data.previousTotals.clicks} />
              </Kpi>
              <Kpi label="Impressions" value={formatNumber(gsc.data.totals.impressions)}>
                <Delta now={gsc.data.totals.impressions} before={gsc.data.previousTotals.impressions} />
              </Kpi>
              <Kpi label="Avg. position" value={gsc.data.totals.position ? String(gsc.data.totals.position) : "—"}>
                <Delta now={gsc.data.totals.position} before={gsc.data.previousTotals.position} lowerIsBetter />
              </Kpi>
            </div>
          ) : (
            <SectionNotice section={gsc} product="Search Console" changeHref={href({ tab: "search-console", change: "1" })} canManage={canManage} />
          )}
        </div>
        <div className="grid gap-3">
          <h2 className="flex items-center gap-2 text-section-title">
            <BarChart3 className="size-4 text-text-muted" aria-hidden /> Website traffic
          </h2>
          {ga.status === "ok" ? (
            <div className="grid grid-cols-3 gap-3">
              <Kpi label="Sessions" value={formatNumber(ga.data.totals.sessions)}>
                <Delta now={ga.data.totals.sessions} before={ga.data.previousTotals.sessions} />
              </Kpi>
              <Kpi label="Users" value={formatNumber(ga.data.totals.users)}>
                <Delta now={ga.data.totals.users} before={ga.data.previousTotals.users} />
              </Kpi>
              <Kpi label="Engagement" value={pct(ga.data.totals.engagementRate)}>
                <Delta now={ga.data.totals.engagementRate} before={ga.data.previousTotals.engagementRate} unit="percent-points" />
              </Kpi>
            </div>
          ) : (
            <SectionNotice section={ga} product="Analytics" changeHref={href({ tab: "analytics", change: "1" })} canManage={canManage} />
          )}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Linked properties" description="AI employees can read these two properties for this website, and nothing else.">
          <ul className="divide-y">
            <LinkedRow product="Search Console" value={site.gscSiteUrl} kind="search_console" changeHref={href({ tab: "search-console", change: "1" })} site={site} canManage={canManage} />
            <LinkedRow product="Analytics" value={site.gaProperty} detail={site.gaPropertyName} kind="analytics" changeHref={href({ tab: "analytics", change: "1" })} site={site} canManage={canManage} />
          </ul>
        </Card>
        <Card
          title="Latest site audit"
          actions={
            <Button asChild size="sm" variant="outline">
              <Link href={href({ tab: "audit" })}>{latest ? "All audits" : "Run an audit"}</Link>
            </Button>
          }
        >
          {latest ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <div className="min-w-0">
                <Link href={`/tasks/${latest.id}`} className="block truncate font-medium hover:underline">
                  {latest.title}
                </Link>
                <p className="text-xs text-text-muted">
                  {latest.agent?.name ? `${latest.agent.name} · ` : ""}started {formatDistanceToNow(latest.createdAt, { addSuffix: true })}
                </p>
              </div>
              <TaskStatusBadge status={latest.status} />
            </div>
          ) : (
            <p className="text-[13px] text-text-secondary">No audit has been run for this website yet.</p>
          )}
        </Card>
      </div>

      {canManage && (
        <div className="flex justify-end">
          <DeleteWebsiteButton websiteId={site.id} domain={site.domain} />
        </div>
      )}
    </div>
  );
}

// ── Site audit ───────────────────────────────────────────────────────────

export async function AuditTab({ site, orgId, canRunAudit, href }: TabProps) {
  const [audits, employees] = await Promise.all([listSiteAudits(orgId, site.id), auditCandidates(orgId)]);
  const missing = [!site.gscSiteUrl && "Search Console", !site.gaProperty && "Analytics"].filter(Boolean) as string[];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Card title="Run an SEO audit" description={`An AI employee reviews ${site.domain} using the properties linked to it and reports what to fix first.`}>
        <div className="grid gap-4">
          {missing.length > 0 && (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning-text">
              {missing.join(" and ")} {missing.length > 1 ? "aren't" : "isn't"} linked yet, so the audit will have no data from {missing.length > 1 ? "them" : "it"}.{" "}
              <Link href={href({ tab: "overview" })} className="underline">
                Link {missing.length > 1 ? "them" : "it"}
              </Link>
            </p>
          )}
          {canRunAudit ? <RunAudit websiteId={site.id} employees={employees} /> : <p className="text-[13px] text-text-secondary">You don&apos;t have permission to start tasks in this workspace.</p>}
        </div>
      </Card>
      <Card title="Previous audits">
        {audits.length === 0 ? (
          <p className="py-2 text-center text-[13px] text-text-muted">No audits yet.</p>
        ) : (
          <ul className="divide-y">
            {audits.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <Link href={`/tasks/${a.id}`} className="block truncate text-[13px] font-medium hover:underline">
                    {a.title}
                  </Link>
                  <p className="text-xs text-text-muted">
                    {a.agent?.name ? `${a.agent.name} · ` : ""}
                    {formatDistanceToNow(a.createdAt, { addSuffix: true })}
                  </p>
                </div>
                <TaskStatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ── Analytics ────────────────────────────────────────────────────────────

export async function AnalyticsTab({ site, orgId, canManage, days, changing, href }: TabProps) {
  const doneHref = href({ tab: "analytics", change: null });
  if (changing || !site.gaProperty) {
    if (!canManage) {
      return <SectionNotice section={{ status: "unlinked" }} product="Analytics" changeHref={doneHref} canManage={false} />;
    }
    const found = await loadSection(true, () => analyticsOptions(orgId, site.id));
    if (found.status !== "ok") return <SectionNotice section={found} product="Analytics" changeHref={doneHref} canManage={canManage} />;
    const options: PickerOption[] = found.data.map((p) => ({
      value: p.property,
      label: `${p.displayName || p.property} · ${p.property.replace("properties/", "")}${p.suggested ? " — best match" : ""}`,
      group: p.accountName || "Other",
    }));
    const initial = site.gaProperty ?? found.data.find((p) => p.suggested)?.property ?? null;
    return <PropertyPicker kind="analytics" websiteId={site.id} options={options} initial={initial} doneHref={doneHref} cancelHref={site.gaProperty ? doneHref : undefined} />;
  }

  const report = await getAnalyticsReport(orgId, site.gaProperty, days);
  if (report.status !== "ok") return <SectionNotice section={report} product="Analytics" changeHref={href({ tab: "analytics", change: "1" })} canManage={canManage} />;
  const r = report.data;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[13px] text-text-secondary">
          Property: <span className="font-medium text-foreground">{site.gaPropertyName ?? site.gaProperty}</span> <span className="text-text-muted">{site.gaProperty}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <RangeNav days={days} options={REPORT_DAYS} href={(d) => href({ days: d === 28 ? null : String(d) })} />
          {canManage && (
            <Button asChild size="sm" variant="outline">
              <Link href={href({ change: "1" })}>Change property</Link>
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-5">
        <Kpi label="Sessions" value={formatNumber(r.totals.sessions)}>
          <Delta now={r.totals.sessions} before={r.previousTotals.sessions} />
        </Kpi>
        <Kpi label="Users" value={formatNumber(r.totals.users)}>
          <Delta now={r.totals.users} before={r.previousTotals.users} />
        </Kpi>
        <Kpi label="New users" value={formatNumber(r.totals.newUsers)}>
          <Delta now={r.totals.newUsers} before={r.previousTotals.newUsers} />
        </Kpi>
        <Kpi label="Page views" value={formatNumber(r.totals.pageViews)}>
          <Delta now={r.totals.pageViews} before={r.previousTotals.pageViews} />
        </Kpi>
        <Kpi label="Engagement rate" value={pct(r.totals.engagementRate)}>
          <Delta now={r.totals.engagementRate} before={r.previousTotals.engagementRate} unit="percent-points" />
        </Kpi>
      </div>
      <Card title="Traffic over time" description={`Sessions and users per day, last ${days} days.`}>
        <TrafficTrendChart data={r.daily} />
      </Card>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Channels" description="Where sessions came from, by channel group.">
          <Breakdown valueLabel="Sessions" items={r.channels.map((c) => ({ key: c.key, value: c.sessions, detail: `${formatNumber(c.users)} users` }))} />
        </Card>
        <Card title="Sources" description="Source and medium.">
          <Breakdown valueLabel="Sessions" items={r.sources.map((c) => ({ key: c.key, value: c.sessions, detail: `${formatNumber(c.users)} users` }))} />
        </Card>
        <Card title="Top pages" description="Most viewed pages.">
          <Breakdown mono valueLabel="Views" items={r.pages.map((p) => ({ key: p.key, value: p.pageViews, detail: `${formatNumber(p.users)} users` }))} />
        </Card>
        <Card title="Countries">
          <Breakdown valueLabel="Sessions" items={r.countries.map((c) => ({ key: c.key, value: c.sessions, detail: `${formatNumber(c.users)} users` }))} />
        </Card>
        <Card title="Devices">
          <Breakdown valueLabel="Sessions" items={r.devices.map((c) => ({ key: c.key, value: c.sessions, detail: `${formatNumber(c.users)} users` }))} />
        </Card>
      </div>
    </div>
  );
}

// ── Search Console ───────────────────────────────────────────────────────

export async function SearchConsoleTab({ site, orgId, canManage, days, changing, href }: TabProps) {
  const doneHref = href({ tab: "search-console", change: null });
  if (changing || !site.gscSiteUrl) {
    if (!canManage) {
      return <SectionNotice section={{ status: "unlinked" }} product="Search Console" changeHref={doneHref} canManage={false} />;
    }
    const found = await loadSection(true, () => searchConsoleOptions(orgId, site.id));
    if (found.status !== "ok") return <SectionNotice section={found} product="Search Console" changeHref={doneHref} canManage={canManage} />;
    const options: PickerOption[] = found.data.map((s) => ({
      value: s.siteUrl,
      label: `${s.siteUrl}${s.kind === "domain" ? " (domain)" : ""}${s.suggested ? " — best match" : ""}`,
      group: s.usable ? "" : "Not verified — no data until ownership is verified in Search Console",
      disabled: !s.usable,
    }));
    const initial = site.gscSiteUrl ?? found.data.find((s) => s.suggested)?.siteUrl ?? null;
    return <PropertyPicker kind="search-console" websiteId={site.id} options={options} initial={initial} doneHref={doneHref} cancelHref={site.gscSiteUrl ? doneHref : undefined} />;
  }

  const report = await getSearchConsoleReport(orgId, site.gscSiteUrl, days);
  if (report.status !== "ok") return <SectionNotice section={report} product="Search Console" changeHref={href({ tab: "search-console", change: "1" })} canManage={canManage} />;
  const r = report.data;
  const detail = (row: { impressions: number; ctr: number; position: number }) => `${formatNumber(row.impressions)} impr · ${pct(row.ctr)} · pos ${row.position}`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[13px] text-text-secondary">
          Property: <span className="font-medium text-foreground">{site.gscSiteUrl}</span>
          <span className="ml-2 text-text-muted">
            {r.period.startDate} to {r.period.endDate} (Search Console runs about 2 days behind)
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <RangeNav days={days} options={REPORT_DAYS} href={(d) => href({ days: d === 28 ? null : String(d) })} />
          {canManage && (
            <Button asChild size="sm" variant="outline">
              <Link href={href({ change: "1" })}>Change property</Link>
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <Kpi label="Clicks" value={formatNumber(r.totals.clicks)}>
          <Delta now={r.totals.clicks} before={r.previousTotals.clicks} />
        </Kpi>
        <Kpi label="Impressions" value={formatNumber(r.totals.impressions)}>
          <Delta now={r.totals.impressions} before={r.previousTotals.impressions} />
        </Kpi>
        <Kpi label="Click-through rate" value={pct(r.totals.ctr)}>
          <Delta now={r.totals.ctr} before={r.previousTotals.ctr} unit="percent-points" />
        </Kpi>
        <Kpi label="Avg. position" value={r.totals.position ? String(r.totals.position) : "—"}>
          <Delta now={r.totals.position} before={r.previousTotals.position} lowerIsBetter />
        </Kpi>
      </div>
      <Card title="Search performance over time" description="Clicks (left axis) and impressions (right axis) per day.">
        <SearchTrendChart data={r.daily} />
      </Card>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Top queries" description="What people searched for before clicking.">
          <Breakdown valueLabel="Clicks" items={r.queries.map((q) => ({ key: q.key, value: q.clicks, detail: detail(q) }))} />
        </Card>
        <Card title="Top pages">
          <Breakdown mono valueLabel="Clicks" items={r.pages.map((p) => ({ key: shortUrl(p.key), value: p.clicks, detail: detail(p) }))} />
        </Card>
        <Card title="Countries">
          <Breakdown valueLabel="Clicks" items={r.countries.map((c) => ({ key: c.key, value: c.clicks, detail: detail(c) }))} />
        </Card>
        <Card title="Devices">
          <Breakdown valueLabel="Clicks" items={r.devices.map((d) => ({ key: d.key, value: d.clicks, detail: detail(d) }))} />
        </Card>
      </div>
    </div>
  );
}
