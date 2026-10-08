import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readJson } from "@/lib/api/http";
import { handleMessage } from "@/lib/mcp/server";
import { randomToken } from "@/lib/security/crypto";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { isAppError } from "@/lib/errors";
import { authenticateApiKey } from "@/server/services/api-keys";

/**
 * POST /api/mcp — Model Context Protocol endpoint (Streamable HTTP, stateless).
 * Authenticate with `Authorization: Bearer nby_…`; each tool needs the matching API-key scope.
 */
export async function POST(request: Request) {
  const requestId = `req_${randomToken(9)}`;
  const headers = { "X-Request-Id": requestId };
  const rpc = (id: null, code: number, message: string, status: number) =>
    NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers });
  try {
    const principal = await authenticateApiKey(request.headers.get("authorization"));
    const limit = await hitRateLimit("api", principal.apiKeyId);
    if (!limit.allowed) {
      const retry = String(Math.max(1, Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000)));
      return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests for this API key." } }, { status: 429, headers: { ...headers, "Retry-After": retry } });
    }
    await prisma.usageRecord.create({ data: { orgId: principal.orgId, kind: "API_REQUEST" } });

    const body = await readJson(request);
    const messages = Array.isArray(body) ? body : [body];
    if (!messages.length) return rpc(null, -32600, "Empty batch.", 400);
    const replies = (await Promise.all(messages.map((m) => handleMessage(principal, m)))).filter((r) => r !== null);
    if (!replies.length) return new NextResponse(null, { status: 202, headers });
    return NextResponse.json(Array.isArray(body) ? replies : replies[0], { headers });
  } catch (err) {
    if (isAppError(err)) {
      const status = err.code === "UNAUTHENTICATED" ? 401 : err.status;
      const res = rpc(null, err.code === "VALIDATION" ? -32700 : -32001, err.message, status);
      if (status === 401) res.headers.set("WWW-Authenticate", 'Bearer realm="mcp"');
      return res;
    }
    console.error(`[mcp] ${requestId} unexpected error`, err);
    return rpc(null, -32603, "Internal error.", 500);
  }
}

// Stateless server: no SSE stream and no sessions to terminate.
const notAllowed = () => new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
