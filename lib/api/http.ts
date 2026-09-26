import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { ZodType } from "zod";
import { AppError, isAppError } from "@/lib/errors";
import { randomToken } from "@/lib/security/crypto";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { authenticateApiKey, requireScope, type ApiPrincipal, type ApiScope } from "@/server/services/api-keys";

/**
 * Public API plumbing: API-key auth, scope checks, per-key rate limits, JSON body
 * validation and a consistent error shape: `{ error: { code, message, fields? } }`.
 */

const MAX_BODY_BYTES = 256 * 1024;

export function apiError(err: unknown, requestId: string) {
  if (isAppError(err)) {
    return NextResponse.json({ error: { code: err.code, message: err.message, ...(err.fieldErrors ? { fields: err.fieldErrors } : {}) } }, { status: err.status, headers: { "X-Request-Id": requestId } });
  }
  console.error(`[api] ${requestId} unexpected error`, err);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } }, { status: 500, headers: { "X-Request-Id": requestId } });
}

export async function readJson(request: Request, required = true): Promise<unknown> {
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) throw new AppError("VALIDATION", "Request body is too large (max 256 KB).");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError("VALIDATION", "Request body is too large (max 256 KB).");
  if (!text.trim()) {
    if (required) throw new AppError("VALIDATION", "Send a JSON body.");
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION", "The request body must be valid JSON.");
  }
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const fields: Record<string, string> = {};
  for (const i of parsed.error.issues) fields[i.path.join(".") || "_body"] ??= i.message;
  throw new AppError("VALIDATION", "The request body is invalid.", { fieldErrors: fields });
}

/** Wraps a v1 handler: authenticates the key, checks the scope, applies the per-key rate limit. */
export async function withApiKey(request: Request, scope: ApiScope, handler: (p: ApiPrincipal, requestId: string) => Promise<Response>): Promise<Response> {
  const requestId = `req_${randomToken(9)}`;
  try {
    const principal = await authenticateApiKey(request.headers.get("authorization"));
    requireScope(principal, scope);
    const limit = await hitRateLimit("api", principal.apiKeyId);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests for this API key." } },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000))), "X-Request-Id": requestId } },
      );
    }
    // Metered for plan entitlements (spec §121).
    await prisma.usageRecord.create({ data: { orgId: principal.orgId, kind: "API_REQUEST" } });
    const res = await handler(principal, requestId);
    res.headers.set("X-Request-Id", requestId);
    res.headers.set("X-RateLimit-Limit", String(limit.limit));
    res.headers.set("X-RateLimit-Remaining", String(limit.remaining));
    return res;
  } catch (err) {
    return apiError(err, requestId);
  }
}
