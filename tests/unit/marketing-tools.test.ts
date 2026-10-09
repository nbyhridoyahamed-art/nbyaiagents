import { afterEach, describe, expect, it, vi } from "vitest";
import { MARKETING_TOOLS, normalizeProperty, searchConsoleRange } from "@/lib/integrations/google/marketing-tools";
import type { ToolExecutionContext } from "@/lib/tools/types";

afterEach(() => vi.restoreAllMocks());

const ctx = { secret: "ya29.test-access-token" } as ToolExecutionContext;
const tool = (key: string) => MARKETING_TOOLS.find((t) => t.key === key)!;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function lastCall(fetchMock: ReturnType<typeof vi.spyOn>) {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
  return { url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined, method: init?.method ?? "GET" };
}

describe("searchConsoleRange", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");

  it("ends two days ago because Search Console data lags", () => {
    expect(searchConsoleRange(28, undefined, undefined, now)).toEqual({ startDate: "2026-09-10", endDate: "2026-10-07" });
    expect(searchConsoleRange(1, undefined, undefined, now)).toEqual({ startDate: "2026-10-07", endDate: "2026-10-07" });
  });

  it("uses explicit dates and rejects half or reversed ranges", () => {
    expect(searchConsoleRange(28, "2026-01-01", "2026-01-31", now)).toEqual({ startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(() => searchConsoleRange(28, "2026-01-01", undefined, now)).toThrow(/both/);
    expect(() => searchConsoleRange(28, "2026-02-01", "2026-01-01", now)).toThrow(/after/);
  });
});

describe("Search Console tools", () => {
  it("lists sites with the access token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] }));
    const res = await tool("google_search_console.list_sites").execute({}, ctx);
    const call = lastCall(fetchMock);
    expect(call.url).toBe("https://www.googleapis.com/webmasters/v3/sites");
    expect(call.headers.authorization).toBe("Bearer ya29.test-access-token");
    expect(res.output).toEqual({ sites: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] });
  });

  it("queries performance with filters and shapes the rows", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ rows: [{ keys: ["seo audit", "https://example.com/seo"], clicks: 12, impressions: 340, ctr: 0.123456, position: 3.456 }] }));
    const res = await tool("google_search_console.search_performance").execute(
      { siteUrl: "sc-domain:example.com", days: 7, dimensions: ["query", "page"], rowLimit: 5, queryContains: "seo" },
      ctx,
    );
    const call = lastCall(fetchMock);
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query");
    expect(call.body).toMatchObject({ dimensions: ["query", "page"], rowLimit: 5, dimensionFilterGroups: [{ groupType: "and", filters: [{ dimension: "query", operator: "contains", expression: "seo" }] }] });
    expect(call.body.startDate <= call.body.endDate).toBe(true);
    expect((res.output as { rows: unknown[] }).rows).toEqual([{ query: "seo audit", page: "https://example.com/seo", clicks: 12, impressions: 340, ctr: 0.1235, position: 3.5 }]);
  });

  it("defaults to the top 25 queries and sends no filter group", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({}));
    const res = await tool("google_search_console.search_performance").execute({ siteUrl: "https://example.com/" }, ctx);
    const call = lastCall(fetchMock);
    expect(call.body).toMatchObject({ dimensions: ["query"], rowLimit: 25 });
    expect(call.body.dimensionFilterGroups).toBeUndefined();
    expect((res.output as { rows: unknown[] }).rows).toEqual([]);
  });

  it("inspects a URL and returns the indexing facts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({
        inspectionResult: {
          indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed", indexingState: "INDEXING_ALLOWED", lastCrawlTime: "2026-10-01T00:00:00Z", googleCanonical: "https://example.com/" },
          mobileUsabilityResult: { verdict: "PASS" },
        },
      }),
    );
    const res = await tool("google_search_console.inspect_url").execute({ siteUrl: "https://example.com/", url: "https://example.com/" }, ctx);
    const call = lastCall(fetchMock);
    expect(call.url).toBe("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect");
    expect(call.body).toMatchObject({ inspectionUrl: "https://example.com/", siteUrl: "https://example.com/" });
    expect(res.output).toMatchObject({ verdict: "PASS", coverageState: "Submitted and indexed", googleCanonical: "https://example.com/", mobileUsability: "PASS" });
  });

  it("tells the admin when the Google API isn't enabled yet", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ error: { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } }, 403));
    await expect(tool("google_search_console.list_sites").execute({}, ctx)).rejects.toThrow(/isn't enabled in the Google Cloud project/);
  });

  it("refuses to run without a connected Google account", async () => {
    await expect(tool("google_search_console.list_sites").execute({}, { secret: null } as ToolExecutionContext)).rejects.toThrow(/isn't connected/);
  });
});

describe("Analytics (GA4) tools", () => {
  it("normalizes property ids", () => {
    expect(normalizeProperty("123456")).toBe("properties/123456");
    expect(normalizeProperty(" properties/987654321 ")).toBe("properties/987654321");
    expect(() => normalizeProperty("../accounts/1")).toThrow(/property id/);
    expect(() => normalizeProperty("properties/abc")).toThrow(/property id/);
  });

  it("flattens account summaries into properties", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ accountSummaries: [{ account: "accounts/1", displayName: "Joyroom", propertySummaries: [{ property: "properties/11", displayName: "Joyroom site" }, { property: "properties/12" }] }, { account: "accounts/2" }] }),
    );
    const res = await tool("google_analytics.list_properties").execute({}, ctx);
    expect((res.output as { properties: unknown[] }).properties).toEqual([
      { account: "accounts/1", accountName: "Joyroom", property: "properties/11", displayName: "Joyroom site" },
      { account: "accounts/1", accountName: "Joyroom", property: "properties/12", displayName: "" },
    ]);
  });

  it("runs a report with defaults and returns numeric rows and totals", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({
        rowCount: 2,
        rows: [
          { dimensionValues: [{ value: "Organic Search" }], metricValues: [{ value: "120" }, { value: "90" }] },
          { dimensionValues: [{ value: "Direct" }], metricValues: [{ value: "30" }, { value: "25" }] },
        ],
        totals: [{ metricValues: [{ value: "150" }, { value: "115" }] }],
      }),
    );
    const res = await tool("google_analytics.run_report").execute({ property: "123456" }, ctx);
    const call = lastCall(fetchMock);
    expect(call.url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/123456:runReport");
    expect(call.body).toMatchObject({
      dateRanges: [{ startDate: "28daysAgo", endDate: "yesterday" }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      limit: "25",
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    });
    expect(res.output).toMatchObject({
      rows: [
        { sessionDefaultChannelGroup: "Organic Search", sessions: 120, activeUsers: 90 },
        { sessionDefaultChannelGroup: "Direct", sessions: 30, activeUsers: 25 },
      ],
      totals: { sessions: 150, activeUsers: 115 },
    });
  });

  it("only accepts GA4-looking names and dates", () => {
    const schema = tool("google_analytics.run_report").inputSchema;
    expect(schema.safeParse({ property: "123456", metrics: ["sessions"], dimensions: ["pagePath"], startDate: "2026-09-01", endDate: "today" }).success).toBe(true);
    expect(schema.safeParse({ property: "123456", metrics: ["sessions; drop"] }).success).toBe(false);
    expect(schema.safeParse({ property: "123456", startDate: "last week" }).success).toBe(false);
  });
});
