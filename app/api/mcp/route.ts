import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, readJson } from "@/lib/api/http";
import { handleMcpMessage } from "@/lib/mcp/server";
import { isAppError } from "@/lib/errors";
import { randomToken } from "@/lib/security/crypto";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { authenticateApiKey } from "@/server/services/api-keys";

/**
 * POST /api/mcp — Model Context Protocol endpoint (Streamable HTTP).
 * Connect Claude, ChatGPT or any MCP client with `Authorization: Bearer <API key>`.
 * Tools are limited to the permissions (scopes) granted to the key.
 */
export async function POST(request: Request) {
  const requestId = `req_${randomToken(9)}`;
  try {
    const principal = await authenticateApiKey(request.headers.get("authorization"));
    const limit = await hitRateLimit("api", principal.apiKeyId);
    if (!limit.allowed) {
      return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests for this API key." } }, { status: 429, headers: { "X-Request-Id": requestId } });
    }
    await prisma.usageRecord.create({ data: { orgId: principal.orgId, kind: "API_REQUEST" } });

    const body = await readJson(request);
    const batch = Array.isArray(body);
    const messages = batch ? body : [body];
    const out = (await Promise.all(messages.map((m) => handleMcpMessage(m, principal)))).filter((r) => r !== null);
    if (!out.length) return new Response(null, { status: 202, headers: { "X-Request-Id": requestId } });
    return NextResponse.json(batch ? out : out[0], { headers: { "X-Request-Id": requestId } });
  } catch (err) {
    if (isAppError(err) && err.code === "UNAUTHENTICATED") {
      return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: err.message } }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="Virtual Desks Online"', "X-Request-Id": requestId } });
    }
    if (isAppError(err) && err.code === "VALIDATION") {
      return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: err.message } }, { status: 400, headers: { "X-Request-Id": requestId } });
    }
    return apiError(err, requestId);
  }
}

/** This server never opens a server-to-client stream. */
export function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
