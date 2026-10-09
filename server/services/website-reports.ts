import { isAppError } from "@/lib/errors";
import * as google from "@/lib/integrations/google/client";
import { searchConsoleRange } from "@/lib/integrations/google/marketing-tools";
import { countryName } from "@/lib/websites/countries";
import { googleAccessToken } from "@/server/services/website-access";

/**
 * Dashboard numbers for one website, straight from Search Console and Google Analytics.
 * Each section reports its own state so one failing product never blanks the whole page.
 */

export const REPORT_DAYS = [7, 28, 90] as const;
export type ReportDays = (typeof REPORT_DAYS)[number];

export type Section<T> =
  | { status: "ok"; data: T }
  | { status: "unlinked" }
  | { status: "not_connected"; message: string }
  | { status: "error"; message: string };

export interface DateRange {
  startDate: string;
  endDate: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

/** What a person can do about a Google error, in place of a raw API response. */
export function friendlyGoogleError(message: string): string {
  if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient (authentication )?scopes?/i.test(message)) {
    return "Google needs to be reconnected to allow this report. Reconnect it on the Integrations page.";
  }
  if (/HTTP 429|RESOURCE_EXHAUSTED|quota|rateLimit/i.test(message)) return "Google is limiting requests right now. Try again in a minute.";
  if (/HTTP 403/.test(message) && /permission|forbidden|does not have|not have sufficient/i.test(message) && !/SERVICE_DISABLED|isn't enabled/i.test(message)) {
    return "The connected Google account can't read this property. Choose another property or check its access in Google.";
  }
  if (/HTTP 404/.test(message)) return "Google couldn't find this property any more. Choose it again.";
  return message;
}

export async function loadSection<T>(linked: boolean, load: () => Promise<T>): Promise<Section<T>> {
  if (!linked) return { status: "unlinked" };
  try {
    return { status: "ok", data: await load() };
  } catch (err) {
    if (isAppError(err)) {
      return err.code === "NOT_CONFIGURED" ? { status: "not_connected", message: err.message } : { status: "error", message: friendlyGoogleError(err.message) };
    }
    console.error("[websites] report failed", err);
    return { status: "error", message: "Couldn't load this report. Please try again." };
  }
}

// ── Search Console ───────────────────────────────────────────────────────

export interface SearchTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchRow extends SearchTotals {
  key: string;
}

export interface SearchConsoleReport {
  siteUrl: string;
  days: number;
  period: DateRange;
  previousPeriod: DateRange;
  totals: SearchTotals;
  previousTotals: SearchTotals;
  daily: { date: string; clicks: number; impressions: number }[];
  queries: SearchRow[];
  pages: SearchRow[];
  countries: SearchRow[];
  devices: SearchRow[];
}

/** The same length of time immediately before `range`, for "vs previous period". */
export function previousRange(range: DateRange): DateRange {
  const days = Math.round((Date.parse(range.endDate) - Date.parse(range.startDate)) / DAY) + 1;
  const end = new Date(Date.parse(range.startDate) - DAY);
  return { startDate: iso(new Date(end.getTime() - (days - 1) * DAY)), endDate: iso(end) };
}

const zeroTotals: SearchTotals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

function searchTotals(rows: google.SearchConsoleRow[]): SearchTotals {
  const r = rows[0];
  return r ? { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: round(r.position, 1) } : zeroTotals;
}

const searchRow = (r: google.SearchConsoleRow, label: (key: string) => string = (k) => k): SearchRow => ({
  key: label(r.keys?.[0] ?? ""),
  clicks: r.clicks,
  impressions: r.impressions,
  ctr: r.ctr,
  position: round(r.position, 1),
});

async function buildSearchConsole(orgId: string, siteUrl: string, days: number): Promise<SearchConsoleReport> {
  const token = await googleAccessToken(orgId, "search_console");
  const period = searchConsoleRange(days);
  const previousPeriod = previousRange(period);
  const query = (dimensions: string[], rowLimit: number, range: DateRange = period) => google.searchConsoleQuery(token, siteUrl, { ...range, dimensions, rowLimit });
  const [now, before, daily, queries, pages, countries, devices] = await Promise.all([
    query([], 1),
    query([], 1, previousPeriod),
    query(["date"], 500),
    query(["query"], 10),
    query(["page"], 10),
    query(["country"], 10),
    query(["device"], 5),
  ]);
  return {
    siteUrl,
    days,
    period,
    previousPeriod,
    totals: searchTotals(now),
    previousTotals: searchTotals(before),
    daily: daily.map((r) => ({ date: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions })).sort((a, b) => a.date.localeCompare(b.date)),
    queries: queries.map((r) => searchRow(r)),
    pages: pages.map((r) => searchRow(r)),
    countries: countries.map((r) => searchRow(r, countryName)),
    devices: devices.map((r) => searchRow(r, titleCase)),
  };
}

export function getSearchConsoleReport(orgId: string, siteUrl: string | null, days: number): Promise<Section<SearchConsoleReport>> {
  return loadSection(!!siteUrl, () => buildSearchConsole(orgId, siteUrl!, days));
}

// ── Analytics (GA4) ──────────────────────────────────────────────────────

export interface AnalyticsTotals {
  sessions: number;
  users: number;
  newUsers: number;
  pageViews: number;
  /** 0–1 */
  engagementRate: number;
}

export interface AnalyticsRow {
  key: string;
  sessions: number;
  users: number;
}

export interface PageRow {
  key: string;
  pageViews: number;
  users: number;
}

export interface AnalyticsReport {
  property: string;
  days: number;
  totals: AnalyticsTotals;
  previousTotals: AnalyticsTotals;
  daily: { date: string; sessions: number; users: number }[];
  channels: AnalyticsRow[];
  sources: AnalyticsRow[];
  pages: PageRow[];
  countries: AnalyticsRow[];
  devices: AnalyticsRow[];
}

const num = (v?: { value: string }) => Number(v?.value ?? 0) || 0;

const TOTAL_METRICS = ["sessions", "activeUsers", "newUsers", "screenPageViews", "engagementRate"];

function analyticsTotals(report: google.AnalyticsReport): AnalyticsTotals {
  const m = report.rows?.[0]?.metricValues ?? [];
  return { sessions: num(m[0]), users: num(m[1]), newUsers: num(m[2]), pageViews: num(m[3]), engagementRate: round(num(m[4]), 4) };
}

/** GA4 returns dates as 20261009. */
const gaDate = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v);

async function buildAnalytics(orgId: string, property: string, days: number): Promise<AnalyticsReport> {
  const token = await googleAccessToken(orgId, "analytics");
  const current = { startDate: `${days}daysAgo`, endDate: "yesterday" };
  const previous = { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` };
  const run = (dateRange: DateRange, dimensions: string[], metrics: string[], limit: number, orderBys?: unknown[]) =>
    google.analyticsRunReport(token, property, {
      dateRanges: [dateRange],
      dimensions: dimensions.map((name) => ({ name })),
      metrics: metrics.map((name) => ({ name })),
      limit: String(limit),
      ...(orderBys ? { orderBys } : {}),
    });
  const bySessions = [{ metric: { metricName: "sessions" }, desc: true }];
  const key = (r: NonNullable<google.AnalyticsReport["rows"]>[number]) => r.dimensionValues?.[0]?.value ?? "";
  const rows = (report: google.AnalyticsReport): AnalyticsRow[] => (report.rows ?? []).map((r) => ({ key: key(r), sessions: num(r.metricValues?.[0]), users: num(r.metricValues?.[1]) }));
  const pageRows = (report: google.AnalyticsReport): PageRow[] => (report.rows ?? []).map((r) => ({ key: key(r), pageViews: num(r.metricValues?.[0]), users: num(r.metricValues?.[1]) }));

  const [now, before, daily, channels, sources, pages, countries, devices] = await Promise.all([
    run(current, [], TOTAL_METRICS, 1),
    run(previous, [], TOTAL_METRICS, 1),
    run(current, ["date"], ["sessions", "activeUsers"], 400, [{ dimension: { dimensionName: "date" } }]),
    run(current, ["sessionDefaultChannelGroup"], ["sessions", "activeUsers"], 10, bySessions),
    run(current, ["sessionSourceMedium"], ["sessions", "activeUsers"], 10, bySessions),
    run(current, ["pagePath"], ["screenPageViews", "activeUsers"], 10, [{ metric: { metricName: "screenPageViews" }, desc: true }]),
    run(current, ["country"], ["sessions", "activeUsers"], 10, bySessions),
    run(current, ["deviceCategory"], ["sessions", "activeUsers"], 5, bySessions),
  ]);

  return {
    property,
    days,
    totals: analyticsTotals(now),
    previousTotals: analyticsTotals(before),
    daily: (daily.rows ?? []).map((r) => ({ date: gaDate(r.dimensionValues?.[0]?.value ?? ""), sessions: num(r.metricValues?.[0]), users: num(r.metricValues?.[1]) })).sort((a, b) => a.date.localeCompare(b.date)),
    channels: rows(channels),
    sources: rows(sources),
    pages: pageRows(pages),
    countries: rows(countries),
    devices: rows(devices).map((r) => ({ ...r, key: titleCase(r.key) })),
  };
}

export function getAnalyticsReport(orgId: string, property: string | null, days: number): Promise<Section<AnalyticsReport>> {
  return loadSection(!!property, () => buildAnalytics(orgId, property!, days));
}

// ── Overview (lighter: just the headline numbers) ────────────────────────

export async function getSearchConsoleSummary(orgId: string, siteUrl: string | null, days: number) {
  return loadSection(!!siteUrl, async () => {
    const token = await googleAccessToken(orgId, "search_console");
    const period = searchConsoleRange(days);
    const [now, before] = await Promise.all([
      google.searchConsoleQuery(token, siteUrl!, { ...period, dimensions: [], rowLimit: 1 }),
      google.searchConsoleQuery(token, siteUrl!, { ...previousRange(period), dimensions: [], rowLimit: 1 }),
    ]);
    return { totals: searchTotals(now), previousTotals: searchTotals(before), period };
  });
}

export async function getAnalyticsSummary(orgId: string, property: string | null, days: number) {
  return loadSection(!!property, async () => {
    const token = await googleAccessToken(orgId, "analytics");
    const totals = (range: DateRange) =>
      google.analyticsRunReport(token, property!, { dateRanges: [range], dimensions: [], metrics: TOTAL_METRICS.map((name) => ({ name })), limit: "1" });
    const [now, before] = await Promise.all([totals({ startDate: `${days}daysAgo`, endDate: "yesterday" }), totals({ startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` })]);
    return { totals: analyticsTotals(now), previousTotals: analyticsTotals(before) };
  });
}
