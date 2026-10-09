import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageContext } from "@/lib/auth/context";
import { isAppError } from "@/lib/errors";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { BreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { cn } from "@/lib/utils";
import { REPORT_DAYS } from "@/server/services/website-reports";
import { getWebsite, listWebsites } from "@/server/services/websites";
import { SiteSwitcher } from "../site-switcher";
import { AnalyticsTab, AuditTab, OverviewTab, SearchConsoleTab, type TabProps } from "./tabs";

export const metadata: Metadata = { title: "Website" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "audit", label: "Site audit" },
  { key: "analytics", label: "Analytics" },
  { key: "search-console", label: "Search Console" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function WebsitePage(props: PageProps<"/websites/[id]">) {
  const ctx = await requirePageContext("analytics:read");
  const { id } = await props.params;
  const sp = await props.searchParams;

  const site = await getWebsite(ctx.org.id, id).catch((err) => {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  });
  const sites = await listWebsites(ctx.org.id);

  const tab: TabKey = TABS.find((t) => t.key === first(sp.tab))?.key ?? "overview";
  const requestedDays = Number(first(sp.days));
  const days = (REPORT_DAYS as readonly number[]).includes(requestedDays) ? requestedDays : 28;
  const changing = first(sp.change) === "1";

  /** Builds a link to this website, keeping the current tab and range unless overridden. */
  const href = (patch: Record<string, string | null>) => {
    const next: Record<string, string | null> = { tab: tab === "overview" ? null : tab, days: days === 28 ? null : String(days), change: null, ...patch };
    if (next.tab === "overview") next.tab = null;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value) query.set(key, value);
    return `/websites/${site.id}${query.size ? `?${query}` : ""}`;
  };

  const tabProps: TabProps = {
    site,
    orgId: ctx.org.id,
    canManage: ctx.can("tools:manage"),
    canRunAudit: ctx.can("tasks:write"),
    days,
    changing,
    href,
  };

  return (
    <PageContainer className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <BreadcrumbLabel segment={site.id} label={site.name ?? site.domain} />
      <PageHeader
        className="mb-0 lg:mb-0"
        eyebrow="Website overview"
        title={site.name ?? site.domain}
        description={site.name ? site.domain : undefined}
        actions={<SiteSwitcher sites={sites.map((s) => ({ id: s.id, label: s.name ?? s.domain }))} currentId={site.id} tab={tab} />}
      />
      <nav aria-label="Website sections" className="-mx-4 overflow-x-auto border-b px-4 md:mx-0 md:px-0">
        <ul className="flex gap-1">
          {TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={href({ tab: t.key, change: null })}
                aria-current={tab === t.key ? "page" : undefined}
                scroll={false}
                className={cn(
                  "-mb-px block whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-colors",
                  tab === t.key ? "border-brand text-brand-hover" : "border-transparent text-text-secondary hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {tab === "overview" && <OverviewTab {...tabProps} />}
      {tab === "audit" && <AuditTab {...tabProps} />}
      {tab === "analytics" && <AnalyticsTab {...tabProps} />}
      {tab === "search-console" && <SearchConsoleTab {...tabProps} />}
    </PageContainer>
  );
}
