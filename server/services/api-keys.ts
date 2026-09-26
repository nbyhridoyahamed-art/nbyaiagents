import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/actor";
import { randomToken, sha256 } from "@/lib/security/crypto";
import { writeAudit } from "@/server/services/audit";

/**
 * Scoped API keys (spec §47). The full key is shown exactly once; only its SHA-256
 * hash and a short, non-secret prefix are stored.
 */

export const API_SCOPES = {
  "agents:read": "List AI employees",
  "agents:run": "Give AI employees work (creates tasks)",
  "workflows:read": "List workflows",
  "workflows:run": "Run published workflows (and call webhooks)",
  "tasks:read": "Read tasks and their results",
} as const;
export type ApiScope = keyof typeof API_SCOPES;
export const API_SCOPE_KEYS = Object.keys(API_SCOPES) as [ApiScope, ...ApiScope[]];

const KEY_PREFIX = "nby_";

export interface ApiPrincipal {
  orgId: string;
  apiKeyId: string;
  scopes: ApiScope[];
}

export function apiActor(p: ApiPrincipal): Actor {
  return { orgId: p.orgId, apiKeyId: p.apiKeyId, type: "API_KEY" };
}

export async function createApiKey(actor: Actor & { userId: string }, input: { name: string; scopes: ApiScope[]; expiresInDays?: number | null }) {
  const name = input.name.trim();
  if (!name) throw new AppError("VALIDATION", "Name the key.", { fieldErrors: { name: "Name the key." } });
  const scopes = [...new Set(input.scopes)].filter((s) => s in API_SCOPES);
  if (!scopes.length) throw new AppError("VALIDATION", "Choose at least one permission.", { fieldErrors: { scopes: "Choose at least one permission." } });
  const publicPart = randomToken(6).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).padEnd(8, "x");
  const key = `${KEY_PREFIX}${publicPart}_${randomToken(32)}`;
  const row = await prisma.apiKey.create({
    data: {
      orgId: actor.orgId,
      name: name.slice(0, 80),
      prefix: `${KEY_PREFIX}${publicPart}`,
      hashedKey: sha256(key),
      scopes,
      createdById: actor.userId,
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
    },
  });
  await writeAudit({ orgId: actor.orgId, actorType: "USER", actorUserId: actor.userId, action: "apikey.create", entityType: "ApiKey", entityId: row.id, metadata: { name: row.name, scopes } });
  return { id: row.id, key, prefix: row.prefix };
}

export async function listApiKeys(orgId: string) {
  return prisma.apiKey.findMany({
    where: { orgId },
    orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    select: { id: true, name: true, prefix: true, scopes: true, createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdById: true },
  });
}

export async function revokeApiKey(actor: Actor & { userId: string }, id: string) {
  const key = await prisma.apiKey.findFirst({ where: { id, orgId: actor.orgId } });
  if (!key) throw notFound("API key");
  if (key.revokedAt) return;
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await writeAudit({ orgId: actor.orgId, actorType: "USER", actorUserId: actor.userId, action: "apikey.revoke", entityType: "ApiKey", entityId: id });
}

/** Resolves `Authorization: Bearer nby_…`. Throws UNAUTHENTICATED for anything invalid. */
export async function authenticateApiKey(authorization: string | null): Promise<ApiPrincipal> {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  if (!match || !match[1].startsWith(KEY_PREFIX)) throw new AppError("UNAUTHENTICATED", "Provide an API key as `Authorization: Bearer nby_…`.");
  const row = await prisma.apiKey.findUnique({ where: { hashedKey: sha256(match[1]) }, include: { organization: { select: { deletedAt: true, suspendedAt: true } } } });
  if (!row || row.revokedAt || row.organization.deletedAt || row.organization.suspendedAt) throw new AppError("UNAUTHENTICATED", "This API key is invalid or has been revoked.");
  if (row.expiresAt && row.expiresAt < new Date()) throw new AppError("UNAUTHENTICATED", "This API key has expired.");
  // Throttle last-used writes to once a minute per key.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  return { orgId: row.orgId, apiKeyId: row.id, scopes: row.scopes.filter((s): s is ApiScope => s in API_SCOPES) };
}

export function requireScope(p: ApiPrincipal, scope: ApiScope) {
  if (!p.scopes.includes(scope)) throw new AppError("FORBIDDEN", `This API key is missing the “${scope}” permission.`);
}
