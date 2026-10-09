import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { finalizeOAuthConnection } from "@/server/services/integrations";
import { testTool } from "@/server/services/tools";
import { getWebsiteScope } from "@/server/services/website-access";
import {
  analyticsOptions,
  auditBrief,
  createWebsite,
  deleteWebsite,
  getWebsite,
  linkAnalytics,
  linkSearchConsole,
  listSiteAudits,
  listWebsites,
  searchConsoleOptions,
  startSiteAudit,
  unlinkProperty,
} from "@/server/services/websites";
import { createFixtureAgent, createFixtureOrg, resetDb, toolId } from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterEach(() => vi.restoreAllMocks());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Answers Google API calls by URL fragment; anything else is a 404 so surprises show up. */
function googleApi(routes: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const hit = Object.entries(routes).find(([fragment]) => url.includes(fragment));
    return hit ? json(hit[1]) : json({ error: `unexpected ${url}` }, 404);
  });
}

const SITES = {
  siteEntry: [
    { siteUrl: "sc-domain:mobilecover.com.bd", permissionLevel: "siteOwner" },
    { siteUrl: "sc-domain:joyroombangladesh.com", permissionLevel: "siteUnverifiedUser" },
    { siteUrl: "https://other-client.com/", permissionLevel: "siteFullUser" },
  ],
};
const PROPERTIES = {
  accountSummaries: [
    { account: "accounts/1", displayName: "Mobile Cover", propertySummaries: [{ property: "properties/111", displayName: "Mobile Cover BD" }] },
    { account: "accounts/2", displayName: "Other", propertySummaries: [{ property: "properties/222", displayName: "Other client" }] },
  ],
};

const connectGoogle = (actor: Actor) =>
  finalizeOAuthConnection(actor, "google", { accessToken: "ya29.websites", refreshToken: "1//refresh", expiresAt: Date.now() + 3_600_000, scope: "x" });

describe("adding websites", () => {
  it("stores a normalised address and tidy name", async () => {
    const { actor, org } = await createFixtureOrg();
    const site = await createWebsite(actor, { domain: "https://WWW.MobileCover.com.bd/shop?x=1", name: "  Mobile Cover  " });
    expect(site).toMatchObject({ orgId: org.id, domain: "mobilecover.com.bd", name: "Mobile Cover", gscSiteUrl: null, gaProperty: null });
    expect(await prisma.auditLog.count({ where: { orgId: org.id, action: "website.create", entityId: site.id } })).toBe(1);
  });

  it("rejects a duplicate in any spelling, but another workspace may add the same site", async () => {
    const a = await createFixtureOrg("A");
    const b = await createFixtureOrg("B");
    await createWebsite(a.actor, { domain: "mobilecover.com.bd" });
    await expect(createWebsite(a.actor, { domain: "http://www.MobileCover.com.bd/" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createWebsite(b.actor, { domain: "mobilecover.com.bd" })).resolves.toMatchObject({ domain: "mobilecover.com.bd" });
  });

  it("rejects things that aren't websites", async () => {
    const { actor } = await createFixtureOrg();
    await expect(createWebsite(actor, { domain: "not a site" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await prisma.website.count()).toBe(0);
  });

  it("keeps each workspace's websites private", async () => {
    const a = await createFixtureOrg("A");
    const b = await createFixtureOrg("B");
    const site = await createWebsite(a.actor, { domain: "mine.example" });
    await expect(getWebsite(b.org.id, site.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listWebsites(b.org.id)).toEqual([]);
    await expect(deleteWebsite(b.actor, site.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.website.count({ where: { id: site.id } })).toBe(1);
  });
});

describe("linking Search Console", () => {
  it("links a property the connected account can read", async () => {
    const { actor } = await createFixtureOrg();
    await connectGoogle(actor);
    googleApi({ "webmasters/v3/sites": SITES });
    const site = await createWebsite(actor, { domain: "mobilecover.com.bd" });

    const linked = await linkSearchConsole(actor, site.id, "sc-domain:mobilecover.com.bd");

    expect(linked.gscSiteUrl).toBe("sc-domain:mobilecover.com.bd");
    expect(await prisma.auditLog.count({ where: { orgId: actor.orgId, action: "website.link_search_console" } })).toBe(1);
  });

  it("refuses a property the account can't read, or that isn't verified", async () => {
    const { actor } = await createFixtureOrg();
    await connectGoogle(actor);
    googleApi({ "webmasters/v3/sites": SITES });
    const site = await createWebsite(actor, { domain: "joyroombangladesh.com" });

    await expect(linkSearchConsole(actor, site.id, "sc-domain:somebody-else.com")).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/isn't available/) });
    await expect(linkSearchConsole(actor, site.id, "sc-domain:joyroombangladesh.com")).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/verified/) });
    expect((await getWebsite(actor.orgId, site.id)).gscSiteUrl).toBeNull();
  });

  it("asks for Google to be connected first", async () => {
    const { actor } = await createFixtureOrg();
    const site = await createWebsite(actor, { domain: "mobilecover.com.bd" });
    await expect(linkSearchConsole(actor, site.id, "sc-domain:mobilecover.com.bd")).rejects.toMatchObject({ code: "NOT_CONFIGURED", message: expect.stringMatching(/isn't connected/) });
  });

  it("offers the likely match first and marks unverified properties unusable", async () => {
    const { actor } = await createFixtureOrg();
    await connectGoogle(actor);
    googleApi({ "webmasters/v3/sites": SITES });
    const site = await createWebsite(actor, { domain: "mobilecover.com.bd" });

    const options = await searchConsoleOptions(actor.orgId, site.id);

    expect(options[0]).toMatchObject({ siteUrl: "sc-domain:mobilecover.com.bd", suggested: true, usable: true });
    expect(options.find((o) => o.siteUrl === "sc-domain:joyroombangladesh.com")).toMatchObject({ usable: false, suggested: false });
  });
});

describe("linking Analytics", () => {
  it("links a property by id and remembers its name", async () => {
    const { actor } = await createFixtureOrg();
    await connectGoogle(actor);
    googleApi({ accountSummaries: PROPERTIES });
    const site = await createWebsite(actor, { domain: "mobilecover.com.bd" });

    const linked = await linkAnalytics(actor, site.id, "111");

    expect(linked).toMatchObject({ gaProperty: "properties/111", gaPropertyName: "Mobile Cover BD" });
  });

  it("refuses a property the account can't read and malformed ids", async () => {
    const { actor } = await createFixtureOrg();
    await connectGoogle(actor);
    googleApi({ accountSummaries: PROPERTIES });
    const site = await createWebsite(actor, { domain: "mobilecover.com.bd" });

    await expect(linkAnalytics(actor, site.id, "properties/999")).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/isn't available/) });
    await expect(linkAnalytics(actor, site.id, "../accounts/1")).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await getWebsite(actor.orgId, site.id)).gaProperty).toBeNull();
  });

  it("ranks properties named after the site first", async () => {
    const { actor } = await createFixtureOrg();
    await connectGoogle(actor);
    googleApi({ accountSummaries: PROPERTIES });
    const site = await createWebsite(actor, { domain: "mobilecover.com.bd" });
    const options = await analyticsOptions(actor.orgId, site.id);
    expect(options[0]).toMatchObject({ property: "properties/111", suggested: true });
    expect(options.filter((o) => o.suggested)).toHaveLength(1);
  });

  it("can be unlinked again", async () => {
    const { actor } = await createFixtureOrg();
    await connectGoogle(actor);
    googleApi({ accountSummaries: PROPERTIES, "webmasters/v3/sites": SITES });
    const site = await createWebsite(actor, { domain: "mobilecover.com.bd" });
    await linkAnalytics(actor, site.id, "properties/111");
    await linkSearchConsole(actor, site.id, "sc-domain:mobilecover.com.bd");

    await unlinkProperty(actor, site.id, "analytics");

    expect(await getWebsite(actor.orgId, site.id)).toMatchObject({ gaProperty: null, gaPropertyName: null, gscSiteUrl: "sc-domain:mobilecover.com.bd" });
  });
});

describe("AI employees only see the websites you linked", () => {
  it("keeps the whole account visible until the first website is added", async () => {
    const { actor } = await createFixtureOrg();
    await connectGoogle(actor);
    googleApi({ "webmasters/v3/sites": SITES });
    expect((await getWebsiteScope(actor.orgId)).restricted).toBe(false);

    const res = await testTool(actor, await toolId(actor.orgId, "google_search_console.list_sites"), {}, "LIVE");
    expect(res.summary).toBe("3 Search Console sites");
  });

  it("limits the Google tools to the linked properties once a website exists", async () => {
    const { actor } = await createFixtureOrg();
    await connectGoogle(actor);
    const fetchMock = googleApi({ "webmasters/v3/sites": SITES, accountSummaries: PROPERTIES, searchAnalytics: { rows: [] }, runReport: { rows: [] } });
    const site = await createWebsite(actor, { domain: "mobilecover.com.bd" });
    await linkSearchConsole(actor, site.id, "sc-domain:mobilecover.com.bd");
    await linkAnalytics(actor, site.id, "properties/111");
    expect((await getWebsiteScope(actor.orgId)).restricted).toBe(true);

    const sites = await testTool(actor, await toolId(actor.orgId, "google_search_console.list_sites"), {}, "LIVE");
    expect(sites.summary).toBe("1 Search Console site");
    expect(JSON.stringify(sites.output)).not.toContain("other-client.com");

    const properties = await testTool(actor, await toolId(actor.orgId, "google_analytics.list_properties"), {}, "LIVE");
    expect(properties.summary).toBe("1 GA4 property");

    // A site that belongs to someone else is refused before Google is asked for its data.
    fetchMock.mockClear();
    await expect(testTool(actor, await toolId(actor.orgId, "google_search_console.search_performance"), { siteUrl: "https://other-client.com/" }, "LIVE")).rejects.toThrow(/linked to your websites/);
    await expect(testTool(actor, await toolId(actor.orgId, "google_analytics.run_report"), { property: "properties/222" }, "LIVE")).rejects.toThrow(/linked to your websites/);
    expect(fetchMock).not.toHaveBeenCalled();

    // The website's own address stands in for its linked properties.
    const perf = await testTool(actor, await toolId(actor.orgId, "google_search_console.search_performance"), { siteUrl: "mobilecover.com.bd" }, "LIVE");
    expect(perf.summary).toContain("sc-domain:mobilecover.com.bd");
    await testTool(actor, await toolId(actor.orgId, "google_analytics.run_report"), { property: "mobilecover.com.bd" }, "LIVE");
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain("properties/111:runReport");
  });

  it("goes back to the whole account when the last website is removed", async () => {
    const { actor } = await createFixtureOrg();
    const site = await createWebsite(actor, { domain: "mobilecover.com.bd" });
    expect((await getWebsiteScope(actor.orgId)).restricted).toBe(true);
    await deleteWebsite(actor, site.id);
    expect((await getWebsiteScope(actor.orgId)).restricted).toBe(false);
  });
});

describe("site audit", () => {
  it("names the exact properties in the brief", () => {
    const brief = auditBrief({ domain: "mobilecover.com.bd", name: "Mobile Cover", gscSiteUrl: "sc-domain:mobilecover.com.bd", gaProperty: "properties/111", gaPropertyName: "Mobile Cover BD" });
    expect(brief).toContain("Mobile Cover (mobilecover.com.bd)");
    expect(brief).toContain("sc-domain:mobilecover.com.bd");
    expect(brief).toContain("properties/111 (Mobile Cover BD)");
    expect(auditBrief({ domain: "x.example", name: null, gscSiteUrl: null, gaProperty: null, gaPropertyName: null })).toMatch(/not linked/);
  });

  it("creates a task for the chosen employee carrying the website's properties", async () => {
    const { actor } = await createFixtureOrg();
    await connectGoogle(actor);
    googleApi({ "webmasters/v3/sites": SITES, accountSummaries: PROPERTIES });
    const agent = await createFixtureAgent(actor, {});
    const site = await createWebsite(actor, { domain: "mobilecover.com.bd", name: "Mobile Cover" });
    await linkSearchConsole(actor, site.id, "sc-domain:mobilecover.com.bd");
    await linkAnalytics(actor, site.id, "properties/111");

    const task = await startSiteAudit(actor, site.id, agent.id);

    const saved = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(saved).toMatchObject({ title: "SEO audit — Mobile Cover", agentId: agent.id, orgId: actor.orgId });
    expect(saved.description).toContain("sc-domain:mobilecover.com.bd");
    expect(saved.description).toContain("properties/111");
    expect(saved.inputs).toEqual({ websiteId: site.id, domain: "mobilecover.com.bd", searchConsoleSite: "sc-domain:mobilecover.com.bd", analyticsProperty: "properties/111" });
    expect((await listSiteAudits(actor.orgId, site.id)).map((t) => t.id)).toEqual([task.id]);
  });

  it("won't hand an audit to another workspace's employee", async () => {
    const a = await createFixtureOrg("A");
    const b = await createFixtureOrg("B");
    const foreign = await createFixtureAgent(b.actor, {});
    const site = await createWebsite(a.actor, { domain: "mine.example" });
    await expect(startSiteAudit(a.actor, site.id, foreign.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.task.count({ where: { orgId: a.org.id } })).toBe(0);
  });
});
