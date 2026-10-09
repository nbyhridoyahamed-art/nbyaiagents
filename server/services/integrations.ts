import { prisma } from "@/lib/db";
import { assertIntegrationEnabled, getDisabled } from "@/server/services/platform-settings";
import { AppError, notFound } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { getIntegration, isIntegrationConfigured, INTEGRATIONS, showDemoIntegrations } from "@/lib/integrations/catalog";
import { MOCK_SEED } from "@/lib/integrations/mock/tools";
import { toolsForIntegration, zodToJsonSchema } from "@/lib/tools/registry";
import { recordActivity, writeAudit } from "@/server/services/audit";
import { encryptSecret, secretHint } from "@/lib/security/crypto";
import { OAUTH_PROVIDERS, PROVIDER_INTEGRATION_KEYS } from "@/lib/integrations/oauth/providers";
import { encodeBundle } from "@/lib/integrations/oauth/tokens";
import * as tavilyClient from "@/lib/integrations/search/client";
import * as githubClient from "@/lib/integrations/github/client";
import type { OAuthProviderId, OAuthTokenBundle } from "@/lib/integrations/oauth/types";

export async function listIntegrations(orgId: string) {
  const [connections, disabled] = await Promise.all([
    prisma.integrationConnection.findMany({ where: { orgId }, include: { _count: { select: { tools: true } } } }),
    getDisabled("integrations.disabled"),
  ]);
  const showDemos = showDemoIntegrations();
  // Demo integrations stay visible in a workspace that already connected them, so nothing it uses disappears.
  const visible = INTEGRATIONS.filter((i) => !i.simulated || showDemos || connections.some((c) => c.integrationKey === i.key));
  return visible.map((i) => {
    const conn = connections.find((c) => c.integrationKey === i.key);
    return {
      ...i,
      disabledByPlatform: disabled.includes(i.key),
      configured: isIntegrationConfigured(i.key),
      connection: conn ? { id: conn.id, status: conn.status, isSimulated: conn.isSimulated, connectedAt: conn.connectedAt.toISOString(), tools: conn._count.tools, lastError: conn.lastError } : null,
    };
  });
}

/** Shared upsert of a connection + its tool rows, used by every "connect" path below. */
async function upsertConnectionAndTools(
  tx: Prisma.TransactionClient,
  actor: Actor,
  key: string,
  info: { name: string },
  opts: { isSimulated: boolean; credentialId?: string | null; config?: Record<string, unknown> | null },
) {
  const conn = await tx.integrationConnection.upsert({
    where: { orgId_integrationKey: { orgId: actor.orgId, integrationKey: key } },
    create: {
      orgId: actor.orgId,
      integrationKey: key,
      name: info.name,
      status: "CONNECTED",
      isSimulated: opts.isSimulated,
      credentialId: opts.credentialId ?? null,
      config: (opts.config ?? null) as Prisma.InputJsonValue,
      connectedById: actor.userId ?? null,
    },
    update: { status: "CONNECTED", lastError: null, isSimulated: opts.isSimulated, credentialId: opts.credentialId ?? null, config: (opts.config ?? null) as Prisma.InputJsonValue },
  });
  const defs = toolsForIntegration(key);
  for (const def of defs) {
    await tx.tool.upsert({
      where: { orgId_key: { orgId: actor.orgId, key: def.key } },
      create: {
        orgId: actor.orgId,
        key: def.key,
        name: def.name,
        description: def.description,
        kind: "BUILTIN",
        integrationKey: key,
        connectionId: conn.id,
        riskLevel: def.riskLevel,
        capabilities: def.capabilities,
        inputSchema: zodToJsonSchema(def.inputSchema) as Prisma.InputJsonValue,
        isSimulated: opts.isSimulated,
        createdById: actor.userId ?? null,
      },
      update: { enabled: true, deletedAt: null, connectionId: conn.id, isSimulated: opts.isSimulated },
    });
  }
  return { conn, toolCount: defs.length };
}

/**
 * Connects an integration directly (no external handshake): simulated demo
 * integrations, and real "platform key" integrations (e.g. Web Search) where
 * one operator-set key is shared by every org. OAuth providers (Google,
 * HubSpot, GitHub) connect via /api/integrations/{provider}/authorize instead; Shopify
 * connects via connectShopify() below (it takes a per-org credential).
 */
export async function connectIntegration(actor: Actor, key: string) {
  const info = getIntegration(key);
  if (!info) throw notFound("Integration");
  await assertIntegrationEnabled(key);
  if (info.availability === "coming_soon") throw new AppError("NOT_CONFIGURED", `${info.name} is coming soon and can't be connected yet.`);
  if (info.simulated && !showDemoIntegrations()) throw new AppError("NOT_CONFIGURED", `${info.name} is a demo integration and demo integrations are turned off.`);
  if (info.availability === "requires_setup") {
    if (info.authType === "oauth2") throw new AppError("VALIDATION", `${info.name} connects through a sign-in window — use its Connect button on the Integrations page.`);
    if (info.authType === "credential") throw new AppError("VALIDATION", `${info.name} needs an access token or API key — use its Connect form on the Integrations page.`);
    if (!isIntegrationConfigured(key)) {
      throw new AppError("NOT_CONFIGURED", `${info.name} is not configured on this platform. The operator must set ${info.setupEnv?.join(" and ") || "the required environment variables"}.`);
    }
    // authType "platform_key": configured and ready — connect for real, no per-org secret needed.
    const { conn, toolCount } = await prisma.$transaction((tx) => upsertConnectionAndTools(tx, actor, key, info, { isSimulated: false }));
    await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "integration.connect", entityType: "IntegrationConnection", entityId: conn.id, metadata: { key } });
    await recordActivity({ orgId: actor.orgId, category: "INTEGRATION", actorType: actor.type === "USER" ? "USER" : "SYSTEM", actorUserId: actor.userId, summary: `${info.name} connected.`, detail: `${toolCount} tools available to AI employees.`, link: "/integrations" });
    return conn;
  }
  if (!info.simulated) throw new AppError("VALIDATION", `${info.name} is set up from its own page.`);

  const connection = await prisma.$transaction(async (tx) => {
    const { conn } = await upsertConnectionAndTools(tx, actor, key, info, { isSimulated: true });
    const existing = await tx.mockRecord.count({ where: { orgId: actor.orgId, integrationKey: key } });
    if (existing === 0) {
      for (const seed of MOCK_SEED[key] ?? []) {
        await tx.mockRecord.create({ data: { orgId: actor.orgId, integrationKey: key, collection: seed.collection, data: seed.data as Prisma.InputJsonValue } });
      }
    }
    return conn;
  });
  const defs = toolsForIntegration(key);
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "integration.connect", entityType: "IntegrationConnection", entityId: connection.id, metadata: { key } });
  await recordActivity({
    orgId: actor.orgId,
    category: "INTEGRATION",
    actorType: actor.type === "USER" ? "USER" : "SYSTEM",
    actorUserId: actor.userId,
    summary: `${info.name} connected (simulated).`,
    detail: `${defs.length} tools available to AI employees.`,
    link: "/integrations",
  });
  return connection;
}

/**
 * Web Search (Tavily): the company's own API key, saved encrypted and checked against Tavily first.
 * It takes precedence over the optional platform-wide TAVILY_API_KEY when the tools run.
 */
export async function connectWebSearch(actor: Actor, input: { apiKey: string }) {
  const info = getIntegration("web_search");
  if (!info) throw notFound("Integration");
  await assertIntegrationEnabled("web_search");
  const apiKey = input.apiKey.trim();
  if (apiKey.length < 16 || /\s/.test(apiKey)) {
    throw new AppError("VALIDATION", "That doesn't look like a Tavily API key.", { fieldErrors: { apiKey: "Paste the whole key. It starts with tvly-." } });
  }
  if ((await tavilyClient.verifyApiKey(apiKey)) === "rejected") {
    throw new AppError("VALIDATION", "Tavily didn't accept that key.", { fieldErrors: { apiKey: "Tavily rejected this key. Copy it again from app.tavily.com." } });
  }

  const { conn, toolCount } = await prisma.$transaction(async (tx) => {
    const cred = await tx.toolCredential.create({
      data: { orgId: actor.orgId, name: "Web Search — Tavily", type: "API_KEY", ciphertext: encryptSecret(apiKey), hint: secretHint(apiKey), createdById: actor.userId ?? null },
    });
    return upsertConnectionAndTools(tx, actor, "web_search", info, { isSimulated: false, credentialId: cred.id });
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "integration.connect", entityType: "IntegrationConnection", entityId: conn.id, metadata: { key: "web_search" } });
  await recordActivity({ orgId: actor.orgId, category: "INTEGRATION", actorType: "USER", actorUserId: actor.userId, summary: "Web Search connected.", detail: `${toolCount} tools available to AI employees.`, link: "/integrations" });
  return conn;
}

/** GitHub: a per-org fine-grained access token, checked against GitHub first and stored encrypted. */
export async function connectGitHub(actor: Actor, input: { token: string }) {
  const info = getIntegration("github");
  if (!info) throw notFound("Integration");
  await assertIntegrationEnabled("github");
  const token = input.token.trim();
  if (token.length < 20 || /\s/.test(token)) {
    throw new AppError("VALIDATION", "That doesn't look like a GitHub token.", { fieldErrors: { token: "Paste the whole token. Fine-grained tokens start with github_pat_." } });
  }
  const verified = await githubClient.verifyToken(token);
  if (verified === "rejected") {
    throw new AppError("VALIDATION", "GitHub didn't accept that token.", { fieldErrors: { token: "GitHub rejected this token. Check that it hasn't expired and copy it again." } });
  }

  const { conn, toolCount } = await prisma.$transaction(async (tx) => {
    const cred = await tx.toolCredential.create({
      data: { orgId: actor.orgId, name: `GitHub — ${verified.login}`, type: "API_KEY", ciphertext: encryptSecret(token), hint: secretHint(token), createdById: actor.userId ?? null },
    });
    return upsertConnectionAndTools(tx, actor, "github", info, { isSimulated: false, credentialId: cred.id, config: { login: verified.login } });
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "integration.connect", entityType: "IntegrationConnection", entityId: conn.id, metadata: { key: "github", login: verified.login } });
  await recordActivity({ orgId: actor.orgId, category: "INTEGRATION", actorType: "USER", actorUserId: actor.userId, summary: `GitHub connected as ${verified.login}.`, detail: `${toolCount} tools available to AI employees.`, link: "/integrations" });
  return conn;
}

/** Shopify: a per-org credential (shop domain + Admin API access token), no OAuth. */
export async function connectShopify(actor: Actor, input: { shop: string; accessToken: string }) {
  const info = getIntegration("shopify");
  if (!info) throw notFound("Integration");
  await assertIntegrationEnabled("shopify");
  const shop = input.shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) {
    throw new AppError("VALIDATION", "Enter your store's *.myshopify.com domain.", { fieldErrors: { shop: "e.g. my-store.myshopify.com" } });
  }
  const token = input.accessToken.trim();
  if (token.length < 8) throw new AppError("VALIDATION", "That access token looks too short.", { fieldErrors: { accessToken: "Paste the full Admin API access token." } });

  const { conn, toolCount } = await prisma.$transaction(async (tx) => {
    const cred = await tx.toolCredential.create({
      data: { orgId: actor.orgId, name: `Shopify — ${shop}`, type: "API_KEY", ciphertext: encryptSecret(token), hint: secretHint(token), createdById: actor.userId ?? null },
    });
    return upsertConnectionAndTools(tx, actor, "shopify", info, { isSimulated: false, credentialId: cred.id, config: { shop } });
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "integration.connect", entityType: "IntegrationConnection", entityId: conn.id, metadata: { key: "shopify", shop } });
  await recordActivity({ orgId: actor.orgId, category: "INTEGRATION", actorType: "USER", actorUserId: actor.userId, summary: "Shopify connected.", detail: `${toolCount} tools available to AI employees.`, link: "/integrations" });
  return conn;
}

/**
 * Finishes an OAuth sign-in (Google, HubSpot or GitHub): stores one encrypted credential and
 * fans it out to every catalog entry that shares this provider (see
 * PROVIDER_INTEGRATION_KEYS) — one Google consent screen connects Gmail,
 * Calendar, Sheets, Search Console and Analytics together.
 */
export async function finalizeOAuthConnection(actor: Actor, provider: OAuthProviderId, bundle: OAuthTokenBundle) {
  const { label } = OAUTH_PROVIDERS[provider];
  const keys = PROVIDER_INTEGRATION_KEYS[provider];

  // GitHub's tools act as a person, so record who that is (and confirm the token works) before saving anything.
  let config: Record<string, unknown> | null = null;
  if (provider === "github") {
    const verified = await githubClient.verifyToken(bundle.accessToken);
    if (verified === "rejected") throw new AppError("VALIDATION", "GitHub didn't accept the sign-in. Try connecting again.");
    config = { login: verified.login };
  }

  const results = await prisma.$transaction(async (tx) => {
    const cred = await tx.toolCredential.create({
      data: {
        orgId: actor.orgId,
        name: config?.login ? `${label} — ${String(config.login)}` : `${label} OAuth`,
        type: "OAUTH2",
        ciphertext: encodeBundle(bundle),
        hint: secretHint(bundle.accessToken),
        createdById: actor.userId ?? null,
      },
    });
    const out: { key: string; connId: string; toolCount: number }[] = [];
    for (const key of keys) {
      const info = getIntegration(key);
      if (!info) continue;
      const { conn, toolCount } = await upsertConnectionAndTools(tx, actor, key, info, { isSimulated: false, credentialId: cred.id, config });
      out.push({ key, connId: conn.id, toolCount });
    }
    return out;
  });
  for (const r of results) {
    await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "integration.connect", entityType: "IntegrationConnection", entityId: r.connId, metadata: { key: r.key, provider } });
  }
  await recordActivity({
    orgId: actor.orgId,
    category: "INTEGRATION",
    actorType: "USER",
    actorUserId: actor.userId,
    summary: config?.login ? `${label} connected as ${String(config.login)}.` : `${label} connected.`,
    detail: `${results.map((r) => getIntegration(r.key)?.name).join(", ")} — ${results.reduce((n, r) => n + r.toolCount, 0)} tools available to AI employees.`,
    link: "/integrations",
  });
  return results;
}

export async function disconnectIntegration(actor: Actor, key: string) {
  const conn = await prisma.integrationConnection.findUnique({ where: { orgId_integrationKey: { orgId: actor.orgId, integrationKey: key } } });
  if (!conn) throw notFound("Connection");
  await prisma.$transaction([
    prisma.integrationConnection.update({ where: { id: conn.id }, data: { status: "DISCONNECTED" } }),
    // Tools stay assigned (so reconnecting restores access) but can't execute.
    prisma.tool.updateMany({ where: { orgId: actor.orgId, connectionId: conn.id }, data: { enabled: false } }),
  ]);
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "integration.disconnect", entityType: "IntegrationConnection", entityId: conn.id, metadata: { key } });
  await recordActivity({
    orgId: actor.orgId,
    category: "INTEGRATION",
    actorType: "USER",
    actorUserId: actor.userId,
    summary: `${conn.name} disconnected.`,
    link: "/integrations",
  });
}
