import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { searchConsoleRange } from "@/lib/integrations/google/marketing-tools";
import { countryName } from "@/lib/websites/countries";

const access = vi.hoisted(() => ({ token: vi.fn<(orgId: string, product: string) => Promise<string>>() }));
vi.mock("@/server/services/website-access", () => ({ googleAccessToken: access.token, getWebsiteScope: async () => ({ restricted: false, websites: [] }) }));

import { friendlyGoogleError, getAnalyticsReport, getAnalyticsSummary, getSearchConsoleReport, previousRange } from "@/server/services/website-reports";

afterEach(() => {
  vi.restoreAllMocks();
  access.token.mockReset();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const body = (init: RequestInit | undefined) => JSON.parse(String(init?.body ?? "{}"));

describe("previousRange", () => {
  it("is the same number of days immediately before", () => {
    expect(previousRange({ startDate: "2026-09-10", endDate: "2026-10-07" })).toEqual({ startDate: "2026-08-13", endDate: "2026-09-09" });
    expect(previousRange({ startDate: "2026-10-07", endDate: "2026-10-07" })).toEqual({ startDate: "2026-10-06", endDate: "2026-10-06" });
  });
});

describe("countryName", () => {
  it("turns ISO-3 codes into names and keeps unknown codes visible", () => {
    expect(countryName("bgd")).toBe("Bangladesh");
    expect(countryName("USA")).toBe("United States");
    expect(countryName("xxx")).toBe("XXX");
  });
});

describe("friendlyGoogleError", () => {
  it.each([
    ["Google API returned HTTP 403. ACCESS_TOKEN_SCOPE_INSUFFICIENT", /reconnected/],
    ["Google API returned HTTP 429. RESOURCE_EXHAUSTED", /limiting requests/],
    ["Google API returned HTTP 403. User does not have sufficient permission for site", /can't read this property/],
    ["Google API returned HTTP 404. not found", /couldn't find this property/],
  ])("explains %j", (raw, expected) => {
    expect(friendlyGoogleError(raw)).toMatch(expected);
  });

  it("leaves setup hints and unknown errors alone", () => {
    const disabled = "Google API returned HTTP 403. The API isn't enabled in the Google Cloud project yet.";
    expect(friendlyGoogleError(disabled)).toBe(disabled);
    expect(friendlyGoogleError("Something odd")).toBe("Something odd");
  });
});

describe("Search Console report", () => {
  it("builds totals, comparison, trend and breakdowns", async () => {
    access.token.mockResolvedValue("ya29.t");
    const current = searchConsoleRange(28);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const req = body(init);
      const dims: string[] = req.dimensions;
      if (dims.length === 0) {
        return json({ rows: [req.startDate === current.startDate ? { clicks: 120, impressions: 4000, ctr: 0.03, position: 12.34 } : { clicks: 100, impressions: 5000, ctr: 0.02, position: 14.9 }] });
      }
      if (dims[0] === "date") return json({ rows: [{ keys: ["2026-10-02"], clicks: 5, impressions: 100, ctr: 0.05, position: 9 }, { keys: ["2026-10-01"], clicks: 3, impressions: 90, ctr: 0.03, position: 10 }] });
      if (dims[0] === "country") return json({ rows: [{ keys: ["bgd"], clicks: 90, impressions: 3000, ctr: 0.03, position: 11.04 }] });
      if (dims[0] === "device") return json({ rows: [{ keys: ["MOBILE"], clicks: 100, impressions: 3500, ctr: 0.028, position: 12 }] });
      return json({ rows: [{ keys: [dims[0] === "query" ? "mobile cover" : "https://example.com/p"], clicks: 7, impressions: 70, ctr: 0.1, position: 3.26 }] });
    });

    const res = await getSearchConsoleReport("org_1", "sc-domain:example.com", 28);

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.totals).toEqual({ clicks: 120, impressions: 4000, ctr: 0.03, position: 12.3 });
    expect(res.data.previousTotals).toMatchObject({ clicks: 100, impressions: 5000, position: 14.9 });
    expect(res.data.period).toEqual(current);
    expect(res.data.daily.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(res.data.queries[0]).toMatchObject({ key: "mobile cover", clicks: 7, position: 3.3 });
    expect(res.data.pages[0].key).toBe("https://example.com/p");
    expect(res.data.countries[0].key).toBe("Bangladesh");
    expect(res.data.devices[0].key).toBe("Mobile");
  });

  it("returns zeros for a site with no data yet", async () => {
    access.token.mockResolvedValue("ya29.t");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({}));
    const res = await getSearchConsoleReport("org_1", "sc-domain:new.example", 7);
    expect(res).toMatchObject({ status: "ok", data: { totals: { clicks: 0, impressions: 0 }, daily: [], queries: [] } });
  });

  it("reports an unlinked property without calling Google", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await getSearchConsoleReport("org_1", null, 28)).toEqual({ status: "unlinked" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(access.token).not.toHaveBeenCalled();
  });

  it("separates 'Google not connected' from a failing report", async () => {
    access.token.mockRejectedValueOnce(new AppError("NOT_CONFIGURED", "Google Search Console isn't connected. Connect Google on the Integrations page first."));
    expect(await getSearchConsoleReport("org_1", "sc-domain:example.com", 28)).toMatchObject({ status: "not_connected", message: expect.stringMatching(/isn't connected/) });

    access.token.mockResolvedValue("ya29.t");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ error: { message: "User does not have sufficient permission" } }, 403));
    expect(await getSearchConsoleReport("org_1", "sc-domain:example.com", 28)).toMatchObject({ status: "error", message: expect.stringMatching(/can't read this property/) });
  });

  it("hides unexpected failures behind a generic message", async () => {
    access.token.mockResolvedValue("ya29.t");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed: secret-host.internal"));
    const res = await getSearchConsoleReport("org_1", "sc-domain:example.com", 28);
    expect(res).toEqual({ status: "error", message: "Couldn't load this report. Please try again." });
  });
});

describe("Analytics report", () => {
  it("builds totals, trend and breakdowns from GA4 rows", async () => {
    access.token.mockResolvedValue("ya29.t");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const req = body(init);
      const dims: string[] = req.dimensions.map((d: { name: string }) => d.name);
      const previous = req.dateRanges[0].startDate === "56daysAgo";
      if (dims.length === 0) return json({ rows: [{ metricValues: previous ? ["800", "600", "300", "2000", "0.5"].map((value) => ({ value })) : ["1000", "700", "400", "2500", "0.6123"].map((value) => ({ value })) }] });
      if (dims[0] === "date") return json({ rows: [{ dimensionValues: [{ value: "20261002" }], metricValues: [{ value: "30" }, { value: "20" }] }, { dimensionValues: [{ value: "20261001" }], metricValues: [{ value: "25" }, { value: "18" }] }] });
      if (dims[0] === "pagePath") return json({ rows: [{ dimensionValues: [{ value: "/shop" }], metricValues: [{ value: "500" }, { value: "300" }] }] });
      if (dims[0] === "deviceCategory") return json({ rows: [{ dimensionValues: [{ value: "mobile" }], metricValues: [{ value: "900" }, { value: "650" }] }] });
      return json({ rows: [{ dimensionValues: [{ value: "Organic Search" }], metricValues: [{ value: "400" }, { value: "350" }] }] });
    });

    const res = await getAnalyticsReport("org_1", "properties/111", 28);

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.totals).toEqual({ sessions: 1000, users: 700, newUsers: 400, pageViews: 2500, engagementRate: 0.6123 });
    expect(res.data.previousTotals.sessions).toBe(800);
    expect(res.data.daily).toEqual([
      { date: "2026-10-01", sessions: 25, users: 18 },
      { date: "2026-10-02", sessions: 30, users: 20 },
    ]);
    expect(res.data.channels[0]).toEqual({ key: "Organic Search", sessions: 400, users: 350 });
    expect(res.data.pages[0]).toEqual({ key: "/shop", pageViews: 500, users: 300 });
    expect(res.data.devices[0].key).toBe("Mobile");
    expect(fetchMock.mock.calls.every(([url]) => String(url) === "https://analyticsdata.googleapis.com/v1beta/properties/111:runReport")).toBe(true);
  });

  it("summarises headline numbers with the previous period", async () => {
    access.token.mockResolvedValue("ya29.t");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const previous = body(init).dateRanges[0].startDate === "14daysAgo";
      return json({ rows: [{ metricValues: (previous ? ["10", "9", "8", "7", "0.5"] : ["20", "19", "18", "17", "0.75"]).map((value) => ({ value })) }] });
    });
    const res = await getAnalyticsSummary("org_1", "properties/111", 7);
    expect(res).toMatchObject({ status: "ok", data: { totals: { sessions: 20, engagementRate: 0.75 }, previousTotals: { sessions: 10 } } });
  });

  it("is unlinked without a property", async () => {
    expect(await getAnalyticsReport("org_1", null, 28)).toEqual({ status: "unlinked" });
  });
});
