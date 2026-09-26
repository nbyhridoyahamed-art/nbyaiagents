import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";

export interface RateLimitRule {
  /** Max requests per window. */
  limit: number;
  windowSeconds: number;
}

/** Central limits. Keys are namespaced per org / user / IP by callers. */
export const RATE_LIMITS = {
  authLogin: { limit: 10, windowSeconds: 15 * 60 },
  /** Per account, independent of IP — caps password guessing even if IPs rotate or are spoofed. */
  authLoginAccount: { limit: 20, windowSeconds: 15 * 60 },
  authSignup: { limit: 5, windowSeconds: 60 * 60 },
  authReset: { limit: 5, windowSeconds: 60 * 60 },
  api: { limit: 120, windowSeconds: 60 },
  webhook: { limit: 60, windowSeconds: 60 },
  agentRun: { limit: 60, windowSeconds: 60 },
  workflowRun: { limit: 60, windowSeconds: 60 },
  upload: { limit: 30, windowSeconds: 60 },
  aiRequest: { limit: 120, windowSeconds: 60 },
  toolTest: { limit: 20, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Fixed-window counter stored in PostgreSQL (atomic upsert), so limits hold across
 * multiple app instances without Redis.
 */
/** Scales every limit (e.g. RATE_LIMIT_SCALE=10 for end-to-end tests). Never below 1×. */
function scaledLimit(limit: number) {
  const scale = Number(process.env.RATE_LIMIT_SCALE ?? 1);
  return Number.isFinite(scale) && scale > 1 ? Math.floor(limit * scale) : limit;
}

export async function hitRateLimit(name: RateLimitName, key: string) {
  const rule = { ...RATE_LIMITS[name], limit: scaledLimit(RATE_LIMITS[name].limit) };
  const bucketKey = `${name}:${key}`;
  const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count", "updatedAt")
    VALUES (${bucketKey}, now(), 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${rule.windowSeconds})
                     THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${rule.windowSeconds})
                     THEN now() ELSE "RateLimitBucket"."windowStart" END,
      "updatedAt" = now()
    RETURNING "count", "windowStart"`;
  const row = rows[0];
  const remaining = Math.max(0, rule.limit - row.count);
  const resetAt = new Date(row.windowStart.getTime() + rule.windowSeconds * 1000);
  return { allowed: row.count <= rule.limit, remaining, resetAt, limit: rule.limit };
}

export async function enforceRateLimit(name: RateLimitName, key: string) {
  const result = await hitRateLimit(name, key);
  if (!result.allowed) {
    const minutes = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 60000));
    throw new AppError("RATE_LIMITED", `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, {
      details: { resetAt: result.resetAt.toISOString() },
    });
  }
  return result;
}
