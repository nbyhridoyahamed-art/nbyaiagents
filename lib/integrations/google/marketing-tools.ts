import { z } from "zod";
import type { ToolDefinition, ToolResult } from "@/lib/tools/types";
import { AppError } from "@/lib/errors";
import * as google from "@/lib/integrations/google/client";

/** Google Search Console and Google Analytics (GA4): read-only reporting tools. */

const real = (output: unknown, summary: string): ToolResult => ({ output, summary, simulated: false });

function def<S extends z.ZodType>(d: Omit<ToolDefinition<S>, "simulate"> & { simulate?: ToolDefinition<S>["simulate"] }): ToolDefinition {
  return { ...d, simulate: d.simulate ?? d.execute } as unknown as ToolDefinition;
}

function requireToken(ctx: { secret?: string | null }): string {
  if (!ctx.secret) throw new AppError("NOT_CONFIGURED", "Google isn't connected for this workspace yet.");
  return ctx.secret;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** Search Console data lags by about two days, so "the last N days" ends two days ago. */
export function searchConsoleRange(days: number, startDate?: string, endDate?: string, now = Date.now()): { startDate: string; endDate: string } {
  if (startDate || endDate) {
    if (!startDate || !endDate) throw new AppError("VALIDATION", "Give both startDate and endDate, or use days.");
    if (startDate > endDate) throw new AppError("VALIDATION", "startDate must not be after endDate.");
    return { startDate, endDate };
  }
  const end = new Date(now - 2 * 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return { startDate: toIso(start), endDate: toIso(end) };
}

// GA4 accepts YYYY-MM-DD, today, yesterday and NdaysAgo.
const gaDate = z.string().regex(/^(\d{4}-\d{2}-\d{2}|today|yesterday|\d{1,4}daysAgo)$/, "Use YYYY-MM-DD, today, yesterday or NdaysAgo");
const gaName = z.string().regex(/^[A-Za-z][A-Za-z0-9_:]{0,80}$/, "Use a GA4 API name such as sessions or sessionDefaultChannelGroup");

export function normalizeProperty(value: string): string {
  const m = /^(?:properties\/)?(\d{3,})$/.exec(value.trim());
  if (!m) throw new AppError("VALIDATION", 'Use a GA4 property id like "properties/123456789". Run list_properties to find it.');
  return `properties/${m[1]}`;
}

export const MARKETING_TOOLS: ToolDefinition[] = [
  // ── Search Console ───────────────────────────────────────────────────
  def({
    key: "google_search_console.list_sites",
    integrationKey: "google_search_console",
    name: "List Search Console sites",
    description: "List the websites (properties) this Google account can read in Search Console, with the exact siteUrl to use in other calls.",
    inputSchema: z.object({}),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: false,
    idempotent: true,
    async execute(_input, ctx) {
      const sites = await google.searchConsoleListSites(requireToken(ctx));
      return real({ sites }, `${sites.length} Search Console site${sites.length === 1 ? "" : "s"}`);
    },
  }),
  def({
    key: "google_search_console.search_performance",
    integrationKey: "google_search_console",
    name: "Search performance",
    description:
      "Organic search performance from Google Search Console: clicks, impressions, click-through rate and average position, grouped by query, page, country, device or date. Defaults to the top 25 queries over the last 28 days.",
    inputSchema: z.object({
      siteUrl: z.string().min(4).max(300).describe('The property exactly as listed in Search Console, e.g. "https://example.com/" or "sc-domain:example.com"'),
      days: z.number().int().min(1).max(480).optional().describe("Look back this many days (default 28). Ignored if startDate and endDate are given."),
      startDate: isoDate.optional(),
      endDate: isoDate.optional(),
      dimensions: z.array(z.enum(["query", "page", "country", "device", "date"])).min(1).max(3).optional(),
      rowLimit: z.number().int().min(1).max(100).optional(),
      queryContains: z.string().max(200).optional().describe("Only queries containing this text"),
      pageContains: z.string().max(300).optional().describe("Only pages whose URL contains this text"),
    }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const period = searchConsoleRange(input.days ?? 28, input.startDate, input.endDate);
      const dimensions = input.dimensions ?? ["query"];
      const filters: { dimension: string; operator: string; expression: string }[] = [];
      if (input.queryContains) filters.push({ dimension: "query", operator: "contains", expression: input.queryContains });
      if (input.pageContains) filters.push({ dimension: "page", operator: "contains", expression: input.pageContains });
      const rows = await google.searchConsoleQuery(requireToken(ctx), input.siteUrl, {
        ...period,
        dimensions,
        rowLimit: input.rowLimit ?? 25,
        ...(filters.length ? { dimensionFilterGroups: [{ groupType: "and", filters }] } : {}),
      });
      const shaped = rows.map((r) => ({
        ...Object.fromEntries(dimensions.map((d, i) => [d, r.keys[i] ?? ""])),
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: round(r.ctr, 4),
        position: round(r.position, 1),
      }));
      return real({ siteUrl: input.siteUrl, period, dimensions, rows: shaped }, `${shaped.length} row${shaped.length === 1 ? "" : "s"} for ${input.siteUrl} (${period.startDate} to ${period.endDate})`);
    },
  }),
  def({
    key: "google_search_console.inspect_url",
    integrationKey: "google_search_console",
    name: "Inspect URL",
    description: "Ask Google how it sees one page: whether it is indexed, when it was last crawled, the canonical URL it chose, and mobile and rich-result status.",
    inputSchema: z.object({
      siteUrl: z.string().min(4).max(300).describe("The Search Console property that contains the page"),
      url: z.string().url().max(2000).describe("The full page URL to inspect"),
    }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const r = await google.searchConsoleInspectUrl(requireToken(ctx), input.siteUrl, input.url);
      const index = (r.indexStatusResult ?? {}) as Record<string, unknown>;
      const mobile = r.mobileUsabilityResult as { verdict?: string } | undefined;
      const rich = r.richResultsResult as { verdict?: string } | undefined;
      const output = {
        url: input.url,
        verdict: index.verdict,
        coverageState: index.coverageState,
        indexingState: index.indexingState,
        robotsTxtState: index.robotsTxtState,
        pageFetchState: index.pageFetchState,
        lastCrawlTime: index.lastCrawlTime,
        googleCanonical: index.googleCanonical,
        userCanonical: index.userCanonical,
        crawledAs: index.crawledAs,
        sitemaps: index.sitemap,
        mobileUsability: mobile?.verdict,
        richResults: rich?.verdict,
      };
      return real(output, `${input.url}: ${String(index.coverageState ?? index.verdict ?? "inspected")}`);
    },
  }),

  // ── Analytics (GA4) ──────────────────────────────────────────────────
  def({
    key: "google_analytics.list_properties",
    integrationKey: "google_analytics",
    name: "List Analytics properties",
    description: "List the GA4 properties this Google account can read, with the property id to use in run_report.",
    inputSchema: z.object({}),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: false,
    idempotent: true,
    async execute(_input, ctx) {
      const properties = await google.analyticsListProperties(requireToken(ctx));
      return real({ properties }, `${properties.length} GA4 propert${properties.length === 1 ? "y" : "ies"}`);
    },
  }),
  def({
    key: "google_analytics.run_report",
    integrationKey: "google_analytics",
    name: "Run Analytics report",
    description:
      "Run a GA4 report: choose metrics (sessions, activeUsers, conversions, screenPageViews, …) and dimensions (sessionDefaultChannelGroup, pagePath, country, deviceCategory, date, …). Defaults to sessions and users by channel over the last 28 days.",
    inputSchema: z.object({
      property: z.string().min(3).max(40).describe('GA4 property, e.g. "properties/123456789" (see list_properties)'),
      startDate: gaDate.optional().describe('Default "28daysAgo"'),
      endDate: gaDate.optional().describe('Default "yesterday"'),
      dimensions: z.array(gaName).max(5).optional(),
      metrics: z.array(gaName).min(1).max(8).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      orderByMetric: gaName.optional().describe("Sort descending by this metric (default: the first metric)"),
    }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const property = normalizeProperty(input.property);
      const dimensions = input.dimensions ?? ["sessionDefaultChannelGroup"];
      const metrics = input.metrics ?? ["sessions", "activeUsers"];
      const dateRange = { startDate: input.startDate ?? "28daysAgo", endDate: input.endDate ?? "yesterday" };
      const report = await google.analyticsRunReport(requireToken(ctx), property, {
        dateRanges: [dateRange],
        dimensions: dimensions.map((name) => ({ name })),
        metrics: metrics.map((name) => ({ name })),
        limit: String(input.limit ?? 25),
        orderBys: [{ metric: { metricName: input.orderByMetric ?? metrics[0] }, desc: true }],
        metricAggregations: ["TOTAL"],
      });
      const rows = (report.rows ?? []).map((r) => ({
        ...Object.fromEntries(dimensions.map((n, i) => [n, r.dimensionValues?.[i]?.value ?? ""])),
        ...Object.fromEntries(metrics.map((n, i) => [n, Number(r.metricValues?.[i]?.value ?? 0)])),
      }));
      const totalValues = report.totals?.[0]?.metricValues;
      const totals = totalValues ? Object.fromEntries(metrics.map((n, i) => [n, Number(totalValues[i]?.value ?? 0)])) : undefined;
      return real({ property, dateRange, dimensions, metrics, rowCount: report.rowCount ?? rows.length, rows, totals }, `${rows.length} row${rows.length === 1 ? "" : "s"} from ${property} (${dateRange.startDate} to ${dateRange.endDate})`);
    },
  }),
];
