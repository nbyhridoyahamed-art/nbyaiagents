import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/actor";
import * as google from "@/lib/integrations/google/client";
import { normalizeDomain, rankGaProperties, rankGscSites, type GaPropertyOption, type GscSiteOption } from "@/lib/websites/domain";
import { normalizeProperty } from "@/lib/websites/scope";
import { recordActivity, writeAudit } from "@/server/services/audit";
import { createTask } from "@/server/services/tasks";
import { googleAccessToken } from "@/server/services/website-access";

/**
 * A "website" is the unit people think in: one address, one Search Console property and
 * one Analytics property, chosen once. AI employees' Google tools are limited to what is
 * linked here (see lib/websites/scope.ts), so connecting a Google account that can see
 * many sites doesn't expose the others.
 */

export const MAX_WEBSITES = 50;
export type LinkKind = "search_console" | "analytics";

export async function listWebsites(orgId: string) {
  return prisma.website.findMany({ where: { orgId }, orderBy: [{ createdAt: "asc" }, { domain: "asc" }] });
}

export async function getWebsite(orgId: string, id: string) {
  const site = await prisma.website.findFirst({ where: { id, orgId } });
  if (!site) throw notFound("Website");
  return site;
}

export async function createWebsite(actor: Actor, input: { domain: string; name?: string | null }) {
  const domain = normalizeDomain(input.domain);
  const name = input.name?.trim().slice(0, 80) || null;
  if ((await prisma.website.count({ where: { orgId: actor.orgId } })) >= MAX_WEBSITES) {
    throw new AppError("LIMIT_EXCEEDED", `A workspace can have up to ${MAX_WEBSITES} websites.`);
  }
  const taken = () => new AppError("CONFLICT", `${domain} is already added.`, { fieldErrors: { domain: `${domain} is already added.` } });
  if (await prisma.website.findUnique({ where: { orgId_domain: { orgId: actor.orgId, domain } }, select: { id: true } })) throw taken();

  let site;
  try {
    site = await prisma.website.create({ data: { orgId: actor.orgId, domain, name, createdById: actor.userId ?? null } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw taken();
    throw err;
  }
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "website.create", entityType: "Website", entityId: site.id, metadata: { domain } });
  await recordActivity({ orgId: actor.orgId, category: "INTEGRATION", actorType: "USER", actorUserId: actor.userId, summary: `Website ${domain} added.`, link: `/websites/${site.id}` });
  return site;
}

export async function deleteWebsite(actor: Actor, id: string) {
  const site = await getWebsite(actor.orgId, id);
  await prisma.website.delete({ where: { id: site.id } });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "website.delete", entityType: "Website", entityId: site.id, metadata: { domain: site.domain } });
  await recordActivity({ orgId: actor.orgId, category: "INTEGRATION", actorType: "USER", actorUserId: actor.userId, summary: `Website ${site.domain} removed.`, link: "/websites" });
}

// ── Property pickers ─────────────────────────────────────────────────────

/** Everything the connected Google account can read in Search Console, best match for this site first. */
export async function searchConsoleOptions(orgId: string, websiteId: string): Promise<GscSiteOption[]> {
  const site = await getWebsite(orgId, websiteId);
  const sites = await google.searchConsoleListSites(await googleAccessToken(orgId, "search_console"));
  return rankGscSites(sites, site.domain);
}

/** Every GA4 property the connected Google account can read, best match for this site first. */
export async function analyticsOptions(orgId: string, websiteId: string): Promise<GaPropertyOption[]> {
  const site = await getWebsite(orgId, websiteId);
  const properties = await google.analyticsListProperties(await googleAccessToken(orgId, "analytics"));
  return rankGaProperties(properties, site.domain, site.name);
}

async function recordLink(actor: Actor, siteId: string, domain: string, action: string, summary: string, metadata: Record<string, unknown>) {
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action, entityType: "Website", entityId: siteId, metadata: { domain, ...metadata } });
  await recordActivity({ orgId: actor.orgId, category: "INTEGRATION", actorType: "USER", actorUserId: actor.userId, summary, link: `/websites/${siteId}` });
}

/** Links a Search Console property, after confirming the connected account can really read it. */
export async function linkSearchConsole(actor: Actor, websiteId: string, siteUrl: string) {
  const site = await getWebsite(actor.orgId, websiteId);
  const available = await google.searchConsoleListSites(await googleAccessToken(actor.orgId, "search_console"));
  const chosen = available.find((s) => s.siteUrl === siteUrl);
  if (!chosen) throw new AppError("VALIDATION", "That Search Console property isn't available to the connected Google account.");
  if (chosen.permissionLevel === "siteUnverifiedUser") {
    throw new AppError("VALIDATION", "Search Console hasn't verified ownership of that property, so it returns no data. Verify it in Search Console first.");
  }
  const updated = await prisma.website.update({ where: { id: site.id }, data: { gscSiteUrl: chosen.siteUrl } });
  await recordLink(actor, site.id, site.domain, "website.link_search_console", `Search Console linked to ${site.domain}.`, { siteUrl: chosen.siteUrl });
  return updated;
}

/** Links a GA4 property, after confirming the connected account can really read it. */
export async function linkAnalytics(actor: Actor, websiteId: string, property: string) {
  const site = await getWebsite(actor.orgId, websiteId);
  const wanted = normalizeProperty(property);
  const available = await google.analyticsListProperties(await googleAccessToken(actor.orgId, "analytics"));
  const chosen = available.find((p) => p.property === wanted);
  if (!chosen) throw new AppError("VALIDATION", "That Analytics property isn't available to the connected Google account.");
  const updated = await prisma.website.update({ where: { id: site.id }, data: { gaProperty: chosen.property, gaPropertyName: chosen.displayName || null } });
  await recordLink(actor, site.id, site.domain, "website.link_analytics", `Analytics linked to ${site.domain}.`, { property: chosen.property });
  return updated;
}

export async function unlinkProperty(actor: Actor, websiteId: string, kind: LinkKind) {
  const site = await getWebsite(actor.orgId, websiteId);
  const data = kind === "search_console" ? { gscSiteUrl: null } : { gaProperty: null, gaPropertyName: null };
  const updated = await prisma.website.update({ where: { id: site.id }, data });
  const label = kind === "search_console" ? "Search Console" : "Analytics";
  await recordLink(actor, site.id, site.domain, `website.unlink_${kind}`, `${label} unlinked from ${site.domain}.`, {});
  return updated;
}

// ── Site audit ───────────────────────────────────────────────────────────

type SiteRow = Awaited<ReturnType<typeof getWebsite>>;

/** The task brief. It names the exact properties so the employee never has to guess which ones to use. */
export function auditBrief(site: Pick<SiteRow, "domain" | "name" | "gscSiteUrl" | "gaProperty" | "gaPropertyName">): string {
  const lines = [
    `Run a full SEO audit for ${site.name ? `${site.name} (${site.domain})` : site.domain}.`,
    "",
    "Use only this website's data:",
    `- Website: ${site.domain}`,
    `- Google Search Console property: ${site.gscSiteUrl ?? "not linked — skip search performance and say that it is missing"}`,
    `- Google Analytics 4 property: ${site.gaProperty ? `${site.gaProperty}${site.gaPropertyName ? ` (${site.gaPropertyName})` : ""}` : "not linked — skip traffic data and say that it is missing"}`,
    "",
    "Cover: organic search performance (top queries and pages, and where position or click-through rate leaves clicks on the table), whether the key pages are indexed (URL inspection), traffic by channel and landing page, on-page and technical problems you can verify, and a prioritised action list with quick wins first.",
    "Quote the numbers you pulled and the date range. Do not use data from any other website or property.",
  ];
  return lines.join("\n");
}

export async function startSiteAudit(actor: Actor, websiteId: string, agentId: string) {
  const site = await getWebsite(actor.orgId, websiteId);
  const task = await createTask(
    actor,
    {
      title: `SEO audit — ${site.name || site.domain}`,
      description: auditBrief(site),
      agentId,
      priority: "MEDIUM",
      inputs: { websiteId: site.id, domain: site.domain, searchConsoleSite: site.gscSiteUrl, analyticsProperty: site.gaProperty },
    },
    { run: true },
  );
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "website.audit", entityType: "Website", entityId: site.id, taskId: task.id, metadata: { domain: site.domain, agentId } });
  return task;
}

export async function listSiteAudits(orgId: string, websiteId: string) {
  return prisma.task.findMany({
    where: { orgId, deletedAt: null, inputs: { path: ["websiteId"], equals: websiteId } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, title: true, status: true, createdAt: true, completedAt: true, agent: { select: { id: true, name: true } } },
  });
}

/** Employees that can take an audit, with the most SEO-looking one first. */
export async function auditCandidates(orgId: string) {
  const agents = await prisma.agent.findMany({
    where: { orgId, deletedAt: null, status: "ACTIVE" },
    select: { id: true, name: true, jobTitle: true },
    orderBy: { name: "asc" },
  });
  const seo = (a: { name: string; jobTitle: string }) => /\bseo\b|search|marketing/i.test(`${a.jobTitle} ${a.name}`);
  return [...agents].sort((a, b) => Number(seo(b)) - Number(seo(a)));
}
