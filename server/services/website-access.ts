import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getValidAccessToken } from "@/lib/integrations/oauth/tokens";
import { UNRESTRICTED, type WebsiteScope } from "@/lib/websites/scope";

/** What the workspace has linked, used to keep Google tools inside the websites people chose. */
export async function getWebsiteScope(orgId: string): Promise<WebsiteScope> {
  const websites = await prisma.website.findMany({
    where: { orgId },
    select: { id: true, domain: true, name: true, gscSiteUrl: true, gaProperty: true },
    orderBy: { createdAt: "asc" },
  });
  return websites.length ? { restricted: true, websites } : UNRESTRICTED;
}

const INTEGRATION_FOR = { search_console: "google_search_console", analytics: "google_analytics" } as const;
const LABEL_FOR = { search_console: "Google Search Console", analytics: "Google Analytics" } as const;

export type GoogleProduct = keyof typeof INTEGRATION_FOR;

/** A live Google access token for the workspace, from the connection for that product. */
export async function googleAccessToken(orgId: string, product: GoogleProduct): Promise<string> {
  const connection = await prisma.integrationConnection.findFirst({
    where: { orgId, integrationKey: INTEGRATION_FOR[product], status: "CONNECTED", credentialId: { not: null } },
    select: { credentialId: true },
  });
  if (!connection?.credentialId) {
    throw new AppError("NOT_CONFIGURED", `${LABEL_FOR[product]} isn't connected. Connect Google on the Integrations page first.`);
  }
  return getValidAccessToken(connection.credentialId, "google");
}

/** Which Google products are connected, for showing the right call to action. */
export async function googleStatus(orgId: string): Promise<Record<GoogleProduct, boolean>> {
  const rows = await prisma.integrationConnection.findMany({
    where: { orgId, integrationKey: { in: Object.values(INTEGRATION_FOR) }, status: "CONNECTED" },
    select: { integrationKey: true },
  });
  const connected = new Set(rows.map((r) => r.integrationKey));
  return { search_console: connected.has(INTEGRATION_FOR.search_console), analytics: connected.has(INTEGRATION_FOR.analytics) };
}
