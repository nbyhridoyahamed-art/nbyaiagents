import { AppError } from "@/lib/errors";
import { normalizeDomain } from "@/lib/websites/domain";

/**
 * Which Google properties AI employees may read. Once a workspace has added at least
 * one website, Search Console / Analytics tools only see the properties linked to those
 * websites — never the rest of the connected Google account. A workspace with no
 * websites keeps the original account-wide behaviour.
 */

export interface ScopedWebsite {
  id: string;
  domain: string;
  name: string | null;
  gscSiteUrl: string | null;
  gaProperty: string | null;
}

export interface WebsiteScope {
  restricted: boolean;
  websites: ScopedWebsite[];
}

export const UNRESTRICTED: WebsiteScope = { restricted: false, websites: [] };

export function allowedSites(scope: WebsiteScope): string[] {
  return [...new Set(scope.websites.flatMap((w) => (w.gscSiteUrl ? [w.gscSiteUrl] : [])))];
}

export function allowedProperties(scope: WebsiteScope): string[] {
  return [...new Set(scope.websites.flatMap((w) => (w.gaProperty ? [w.gaProperty] : [])))];
}

/** "123456789" / "properties/123456789" → "properties/123456789"; throws for anything else. */
export function normalizeProperty(value: string): string {
  const m = /^(?:properties\/)?(\d{3,})$/.exec(value.trim());
  if (!m) throw new AppError("VALIDATION", 'Use a GA4 property id like "properties/123456789". Run list_properties to find it.');
  return `properties/${m[1]}`;
}

/** The website a domain, URL or page address belongs to (exact domain first, then a parent domain). */
function websiteFor(scope: WebsiteScope, value: string): ScopedWebsite | undefined {
  let domain: string;
  try {
    domain = normalizeDomain(value);
  } catch {
    return undefined;
  }
  return scope.websites.find((w) => w.domain === domain) ?? scope.websites.find((w) => domain.endsWith(`.${w.domain}`));
}

function notLinked(kind: string, value: string, linked: string[]): AppError {
  return new AppError(
    "VALIDATION",
    `"${value}" isn't one of the ${kind} linked to your websites. Linked: ${linked.length ? linked.join(", ") : "none yet"}. Add or change them under Websites.`,
  );
}

/** Maps a tool's `siteUrl` argument (or a website address) to a linked Search Console property. */
export function resolveSite(scope: WebsiteScope, input: string): string {
  const value = input.trim();
  if (!scope.restricted) return value;
  const sites = allowedSites(scope);
  const exact = sites.find((s) => s === value) ?? sites.find((s) => s.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  const site = websiteFor(scope, value);
  if (site?.gscSiteUrl) return site.gscSiteUrl;
  if (site) throw new AppError("VALIDATION", `${site.domain} has no Search Console property linked yet. Link one under Websites → Search Console.`);
  throw notLinked("Search Console properties", value, sites);
}

/** Maps a tool's `property` argument (or a website address) to a linked GA4 property. */
export function resolveProperty(scope: WebsiteScope, input: string): string {
  const value = input.trim();
  const numeric = /^(?:properties\/)?\d{3,}$/.test(value);
  if (!scope.restricted) return normalizeProperty(value);
  const properties = allowedProperties(scope);
  if (numeric) {
    const property = normalizeProperty(value);
    if (properties.includes(property)) return property;
    throw notLinked("Analytics properties", property, properties);
  }
  const site = websiteFor(scope, value);
  if (site?.gaProperty) return site.gaProperty;
  if (site) throw new AppError("VALIDATION", `${site.domain} has no Analytics property linked yet. Link one under Websites → Analytics.`);
  throw notLinked("Analytics properties", value, properties);
}

export function filterSites<T extends { siteUrl: string }>(scope: WebsiteScope, sites: T[]): T[] {
  if (!scope.restricted) return sites;
  const allowed = new Set(allowedSites(scope));
  return sites.filter((s) => allowed.has(s.siteUrl));
}

export function filterProperties<T extends { property: string }>(scope: WebsiteScope, properties: T[]): T[] {
  if (!scope.restricted) return properties;
  const allowed = new Set(allowedProperties(scope));
  return properties.filter((p) => allowed.has(p.property));
}

/** Added to list results so an agent can see which website each property belongs to. */
export function scopeSummary(scope: WebsiteScope) {
  if (!scope.restricted) return {};
  return {
    limitedToWebsites: true,
    websites: scope.websites.map((w) => ({ domain: w.domain, name: w.name, searchConsoleSite: w.gscSiteUrl, analyticsProperty: w.gaProperty })),
  };
}
