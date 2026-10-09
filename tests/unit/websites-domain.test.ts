import { describe, expect, it } from "vitest";
import { normalizeDomain, rankGaProperties, rankGscSites } from "@/lib/websites/domain";
import { filterProperties, filterSites, resolveProperty, resolveSite, scopeSummary, UNRESTRICTED, type WebsiteScope } from "@/lib/websites/scope";

describe("normalizeDomain", () => {
  it.each([
    ["mobilecover.com.bd", "mobilecover.com.bd"],
    ["  Example.COM  ", "example.com"],
    ["https://www.example.com/", "example.com"],
    ["http://www.example.com:8080/shop?x=1#top", "example.com"],
    ["www.shop.example.co.uk/path", "shop.example.co.uk"],
    ["example.com.", "example.com"],
    ["bücher.de", "xn--bcher-kva.de"],
  ])("turns %j into %j", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each(["", "   ", "localhost", "192.168.0.1", "not a site", "http://", "exa mple.com", "-bad.com", "example", "https://user:pass@", "javascript:alert(1)"])("rejects %j", (input) => {
    expect(() => normalizeDomain(input)).toThrow(/website's address/);
  });

  it("reports the problem on the domain field", () => {
    try {
      normalizeDomain("nope");
      expect.unreachable();
    } catch (err) {
      expect((err as { fieldErrors?: Record<string, string> }).fieldErrors).toHaveProperty("domain");
    }
  });
});

describe("rankGscSites", () => {
  const sites = [
    { siteUrl: "https://other.com/", permissionLevel: "siteOwner" },
    { siteUrl: "http://mobilecover.com.bd/", permissionLevel: "siteOwner" },
    { siteUrl: "https://www.mobilecover.com.bd/", permissionLevel: "siteOwner" },
    { siteUrl: "sc-domain:mobilecover.com.bd", permissionLevel: "siteFullUser" },
    { siteUrl: "https://mobilecover.com.bd/blog/", permissionLevel: "siteOwner" },
    { siteUrl: "sc-domain:joyroombangladesh.com", permissionLevel: "siteUnverifiedUser" },
  ];

  it("puts the domain property first and suggests it", () => {
    const ranked = rankGscSites(sites, "mobilecover.com.bd");
    expect(ranked.map((s) => s.siteUrl)).toEqual([
      "sc-domain:mobilecover.com.bd",
      "https://www.mobilecover.com.bd/",
      "http://mobilecover.com.bd/",
      "https://mobilecover.com.bd/blog/",
      "https://other.com/",
      "sc-domain:joyroombangladesh.com",
    ]);
    expect(ranked.filter((s) => s.suggested).map((s) => s.siteUrl)).toEqual(["sc-domain:mobilecover.com.bd"]);
  });

  it("flags unverified properties as unusable and never suggests them", () => {
    const ranked = rankGscSites(sites, "joyroombangladesh.com");
    const joyroom = ranked.find((s) => s.siteUrl === "sc-domain:joyroombangladesh.com")!;
    expect(joyroom.usable).toBe(false);
    expect(ranked.some((s) => s.suggested)).toBe(false);
    expect(ranked.at(-1)).toBe(joyroom);
  });

  it("treats a parent domain property as covering a subdomain", () => {
    const ranked = rankGscSites([{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }, { siteUrl: "https://zzz.org/", permissionLevel: "siteOwner" }], "shop.example.com");
    expect(ranked[0]).toMatchObject({ siteUrl: "sc-domain:example.com", suggested: true, kind: "domain" });
  });

  it("suggests nothing when no property looks like the site", () => {
    expect(rankGscSites(sites, "unrelated.org").some((s) => s.suggested)).toBe(false);
  });
});

describe("rankGaProperties", () => {
  const properties = [
    { account: "accounts/1", accountName: "Agency", property: "properties/1", displayName: "Client B – Store" },
    { account: "accounts/2", accountName: "Mobile Cover", property: "properties/2", displayName: "Mobile Cover BD" },
    { account: "accounts/3", accountName: "Joyroom", property: "properties/3", displayName: "Joyroom Bangladesh" },
    { account: "accounts/4", accountName: "Misc", property: "properties/4", displayName: "mobilecover.com.bd (GA4)" },
  ];

  it("floats properties named after the site to the top and suggests the first", () => {
    const ranked = rankGaProperties(properties, "mobilecover.com.bd");
    expect(ranked.slice(0, 2).map((p) => p.property).sort()).toEqual(["properties/2", "properties/4"]);
    expect(ranked.filter((p) => p.match).length).toBe(2);
    expect(ranked.filter((p) => p.suggested)).toHaveLength(1);
    expect(ranked[0].suggested).toBe(true);
  });

  it("uses the website's display name too", () => {
    const ranked = rankGaProperties(properties, "jr.example", "Joyroom Bangladesh");
    expect(ranked[0]).toMatchObject({ property: "properties/3", match: true, suggested: true });
  });

  it("ignores generic domain labels like com and bd", () => {
    const ranked = rankGaProperties([{ account: "a", accountName: "A", property: "properties/9", displayName: "Com BD Store" }], "zzzz.com.bd");
    expect(ranked[0].match).toBe(false);
  });
});

describe("scope helpers", () => {
  const scope: WebsiteScope = {
    restricted: true,
    websites: [
      { id: "s1", domain: "example.com", name: "Example", gscSiteUrl: "sc-domain:example.com", gaProperty: "properties/100" },
      { id: "s2", domain: "blog.example.com", name: null, gscSiteUrl: "https://blog.example.com/", gaProperty: null },
    ],
  };

  it("resolves exact properties, addresses and subdomains of a linked site", () => {
    expect(resolveSite(scope, "sc-domain:example.com")).toBe("sc-domain:example.com");
    expect(resolveSite(scope, "SC-DOMAIN:EXAMPLE.COM")).toBe("sc-domain:example.com");
    expect(resolveSite(scope, "https://www.example.com/pricing")).toBe("sc-domain:example.com");
    expect(resolveSite(scope, "shop.example.com")).toBe("sc-domain:example.com");
    expect(resolveSite(scope, "https://blog.example.com/post")).toBe("https://blog.example.com/");
  });

  it("resolves analytics properties by id or address", () => {
    expect(resolveProperty(scope, "100")).toBe("properties/100");
    expect(resolveProperty(scope, "properties/100")).toBe("properties/100");
    expect(resolveProperty(scope, "example.com")).toBe("properties/100");
  });

  it("rejects anything that isn't linked and names what is", () => {
    expect(() => resolveSite(scope, "sc-domain:evil.com")).toThrow(/Linked: sc-domain:example.com, https:\/\/blog.example.com\//);
    expect(() => resolveProperty(scope, "999")).toThrow(/Linked: properties\/100/);
    expect(() => resolveProperty(scope, "blog.example.com")).toThrow(/blog.example.com has no Analytics property linked yet/);
    expect(() => resolveProperty(scope, "../accounts/1")).toThrow(/isn't one of the Analytics properties/);
  });

  it("with no websites, passes values through and still validates property ids", () => {
    expect(resolveSite(UNRESTRICTED, " sc-domain:anything.com ")).toBe("sc-domain:anything.com");
    expect(resolveProperty(UNRESTRICTED, "42424")).toBe("properties/42424");
    expect(() => resolveProperty(UNRESTRICTED, "not-a-property")).toThrow(/property id/);
    expect(scopeSummary(UNRESTRICTED)).toEqual({});
  });

  it("filters lists and summarises the links for the agent", () => {
    expect(filterSites(scope, [{ siteUrl: "sc-domain:example.com" }, { siteUrl: "sc-domain:x.com" }])).toEqual([{ siteUrl: "sc-domain:example.com" }]);
    expect(filterProperties(scope, [{ property: "properties/100" }, { property: "properties/5" }])).toEqual([{ property: "properties/100" }]);
    expect(filterSites(UNRESTRICTED, [{ siteUrl: "a" }, { siteUrl: "b" }])).toHaveLength(2);
    expect(scopeSummary(scope)).toMatchObject({ limitedToWebsites: true, websites: [{ domain: "example.com", analyticsProperty: "properties/100" }, { domain: "blog.example.com", analyticsProperty: null }] });
  });
});
