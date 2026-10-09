import { afterEach, describe, expect, it, vi } from "vitest";
import { MARKETING_TOOLS, normalizeProperty, searchConsoleRange } from "@/lib/integrations/google/marketing-tools";
import type { ToolExecutionContext } from "@/lib/tools/types";
import { UNRESTRICTED, type WebsiteScope } from "@/lib/websites/scope";

// The tools ask which websites the workspace linked; these tests choose the answer.
const scope = vi.hoisted(() => ({ current: { restricted: false, websites: [] } as WebsiteScope }));
vi.mock("@/server/services/website-access", () => ({ getWebsiteScope: async () => scope.current }));

afterEach(() => {
  vi.restoreAllMocks();
  scope.current = UNRESTRICTED;
});

const ctx = { orgId: "org_1", secret: "ya29.test-access-token" } as ToolExecutionContext;
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

describe("tools stay inside the websites a workspace linked", () => {
  const linked: WebsiteScope = {
    restricted: true,
    websites: [
      { id: "site_1", domain: "mobilecover.com.bd", name: "Mobile Cover", gscSiteUrl: "sc-domain:mobilecover.com.bd", gaProperty: "properties/111111" },
      { id: "site_2", domain: "notlinked.example", name: null, gscSiteUrl: null, gaProperty: null },
    ],
  };
  const sites = { siteEntry: [{ siteUrl: "sc-domain:mobilecover.com.bd", permissionLevel: "siteOwner" }, { siteUrl: "sc-domain:other-client.com", permissionLevel: "siteOwner" }] };

  it("lists only the linked Search Console sites and says which website they belong to", async () => {
    scope.current = linked;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(sites));
    const res = await tool("google_search_console.list_sites").execute({}, ctx);
    expect(res.output).toMatchObject({
      sites: [{ siteUrl: "sc-domain:mobilecover.com.bd" }],
      limitedToWebsites: true,
      websites: [{ domain: "mobilecover.com.bd", searchConsoleSite: "sc-domain:mobilecover.com.bd", analyticsProperty: "properties/111111" }, { domain: "notlinked.example", searchConsoleSite: null }],
    });
    expect(JSON.stringify(res.output)).not.toContain("other-client.com");
  });

  it("lists only the linked Analytics properties", async () => {
    scope.current = linked;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ accountSummaries: [{ account: "accounts/1", displayName: "A", propertySummaries: [{ property: "properties/111111", displayName: "Mobile Cover" }, { property: "properties/222222", displayName: "Someone else" }] }] }),
    );
    const res = await tool("google_analytics.list_properties").execute({}, ctx);
    expect((res.output as { properties: { property: string }[] }).properties.map((p) => p.property)).toEqual(["properties/111111"]);
  });

  it("refuses a property that isn't linked, without calling Google", async () => {
    scope.current = linked;
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(tool("google_search_console.search_performance").execute({ siteUrl: "sc-domain:other-client.com" }, ctx)).rejects.toThrow(/isn't one of the Search Console properties linked/);
    await expect(tool("google_search_console.inspect_url").execute({ siteUrl: "https://other-client.com/", url: "https://other-client.com/" }, ctx)).rejects.toThrow(/linked to your websites/);
    await expect(tool("google_analytics.run_report").execute({ property: "properties/222222" }, ctx)).rejects.toThrow(/Analytics properties linked/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts the website address in place of the property", async () => {
    scope.current = linked;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ rows: [] }));
    const sc = await tool("google_search_console.search_performance").execute({ siteUrl: "https://www.mobilecover.com.bd/products" }, ctx);
    expect(lastCall(fetchMock).url).toBe("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Amobilecover.com.bd/searchAnalytics/query");
    expect((sc.output as { siteUrl: string }).siteUrl).toBe("sc-domain:mobilecover.com.bd");

    await tool("google_analytics.run_report").execute({ property: "mobilecover.com.bd" }, ctx);
    expect(lastCall(fetchMock).url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/111111:runReport");
  });

  it("explains when a website has nothing linked yet", async () => {
    scope.current = linked;
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(tool("google_search_console.search_performance").execute({ siteUrl: "notlinked.example" }, ctx)).rejects.toThrow(/no Search Console property linked yet/);
    await expect(tool("google_analytics.run_report").execute({ property: "notlinked.example" }, ctx)).rejects.toThrow(/no Analytics property linked yet/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still sees the whole account until the first website is added", async () => {
    scope.current = UNRESTRICTED;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(sites));
    const res = await tool("google_search_console.list_sites").execute({}, ctx);
    expect((res.output as { sites: unknown[]; limitedToWebsites?: boolean }).sites).toHaveLength(2);
    expect((res.output as { limitedToWebsites?: boolean }).limitedToWebsites).toBeUndefined();
  });
});
