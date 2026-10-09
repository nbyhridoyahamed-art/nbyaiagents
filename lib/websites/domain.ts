import { AppError } from "@/lib/errors";

/**
 * Pure helpers for the Websites feature: normalising what a person types as their
 * site address, and ranking Search Console / Analytics properties so the picker can
 * pre-select the likely match. No I/O, so it is unit-testable.
 */

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
const ADDRESS_HELP = "Enter your website's address, for example example.com.";

/** "https://www.Example.com/shop?x=1" → "example.com". Throws VALIDATION for anything that isn't a public hostname. */
export function normalizeDomain(input: string): string {
  const raw = input.trim();
  const invalid = () => new AppError("VALIDATION", ADDRESS_HELP, { fieldErrors: { domain: ADDRESS_HELP } });
  if (!raw) throw invalid();
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    throw invalid();
  }
  host = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!HOSTNAME.test(host)) throw invalid();
  return host;
}

// ── Search Console ───────────────────────────────────────────────────────

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export interface GscSiteOption extends GscSite {
  /** Search Console only returns data for verified properties. */
  usable: boolean;
  kind: "domain" | "url-prefix";
  /** The best usable match for the website being set up. */
  suggested: boolean;
}

interface ParsedSite {
  host: string;
  domainProperty: boolean;
  https: boolean;
  rootPath: boolean;
}

function parseGscSite(siteUrl: string): ParsedSite | null {
  if (siteUrl.startsWith("sc-domain:")) {
    return { host: siteUrl.slice("sc-domain:".length).toLowerCase(), domainProperty: true, https: true, rootPath: true };
  }
  try {
    const u = new URL(siteUrl);
    return { host: u.hostname.toLowerCase().replace(/^www\./, ""), domainProperty: false, https: u.protocol === "https:", rootPath: u.pathname === "/" };
  } catch {
    return null;
  }
}

/** Lower is a better match for `domain`. 10+ means "not obviously this site". */
function gscScore(siteUrl: string, domain: string): number {
  const p = parseGscSite(siteUrl);
  if (!p) return 90;
  if (p.host === domain) return p.domainProperty ? 0 : !p.rootPath ? 3 : p.https ? 1 : 2;
  // A domain property for the parent (example.com) also covers shop.example.com.
  if (p.domainProperty && domain.endsWith(`.${p.host}`)) return 4;
  return 10;
}

export function rankGscSites(sites: GscSite[], domain: string): GscSiteOption[] {
  const ranked = sites
    .map((s) => {
      const usable = s.permissionLevel !== "siteUnverifiedUser";
      return { site: s, usable, score: gscScore(s.siteUrl, domain) + (usable ? 0 : 50) };
    })
    .sort((a, b) => a.score - b.score || a.site.siteUrl.localeCompare(b.site.siteUrl));
  const best = ranked.find((r) => r.usable && r.score <= 4);
  return ranked.map((r) => ({
    ...r.site,
    usable: r.usable,
    kind: r.site.siteUrl.startsWith("sc-domain:") ? "domain" : "url-prefix",
    suggested: r === best,
  }));
}

// ── Analytics (GA4) ──────────────────────────────────────────────────────

export interface GaProperty {
  property: string;
  displayName: string;
  account: string;
  accountName: string;
}

export interface GaPropertyOption extends GaProperty {
  /** The property's name looks like this website. */
  match: boolean;
  suggested: boolean;
}

// Labels that say nothing about *which* business a domain belongs to.
const GENERIC_LABELS = new Set(["com", "net", "org", "co", "www", "bd", "in", "io", "ai", "app", "dev", "info", "biz", "edu", "gov", "uk", "us", "pk", "au", "ca", "de", "fr", "shop", "store", "online", "site", "web"]);
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function nameCandidates(domain: string, siteName?: string | null): string[] {
  const set = new Set<string>();
  for (const label of domain.split(".")) if (!GENERIC_LABELS.has(label) && label.length >= 3) set.add(compact(label));
  set.add(compact(domain));
  if (siteName) set.add(compact(siteName));
  return [...set].filter((c) => c.length >= 4);
}

export function rankGaProperties(properties: GaProperty[], domain: string, siteName?: string | null): GaPropertyOption[] {
  const candidates = nameCandidates(domain, siteName);
  const looksLikeSite = (p: GaProperty) => {
    const n = compact(p.displayName);
    return n.length > 0 && candidates.some((c) => n.includes(c) || (n.length >= 6 && c.includes(n)));
  };
  const rows = properties.map((p) => ({ ...p, match: looksLikeSite(p) }));
  rows.sort((a, b) => Number(b.match) - Number(a.match) || a.accountName.localeCompare(b.accountName) || a.displayName.localeCompare(b.displayName));
  const first = rows.find((r) => r.match);
  return rows.map((r) => ({ ...r, suggested: r === first }));
}
