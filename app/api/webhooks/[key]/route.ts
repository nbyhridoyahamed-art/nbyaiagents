import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/http";
import { randomToken } from "@/lib/security/crypto";
import { receiveWebhook, SIGNATURE_HEADER } from "@/server/services/webhooks";
import { clientIp } from "@/lib/security/client-ip";

/**
 * POST /api/webhooks/{key} — start a published workflow from another system.
 * Authenticate with `X-VDO-Signature` (HMAC) or `Authorization: Bearer <API key>`.
 * Send `Idempotency-Key` (or `X-VDO-Delivery-Id`) so retries never start a second run.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/webhooks/[key]">) {
  const requestId = `req_${randomToken(9)}`;
  try {
    const { key } = await ctx.params;
    const len = Number(request.headers.get("content-length") ?? 0);
    if (len > 256 * 1024) return NextResponse.json({ error: { code: "VALIDATION", message: "Payload is too large (max 256 KB)." } }, { status: 413 });
    const res = await receiveWebhook({
      key: key.slice(0, 100),
      rawBody: await request.text(),
      signature: request.headers.get(SIGNATURE_HEADER),
      authorization: request.headers.get("authorization"),
      deliveryId: request.headers.get("idempotency-key") ?? request.headers.get("x-vdo-delivery-id"),
      ip: clientIp(request.headers) ?? "unknown",
    });
    return NextResponse.json({ data: { runId: res.runId, status: res.status.toLowerCase() } }, { status: 202, headers: { "X-Request-Id": requestId } });
  } catch (err) {
    return apiError(err, requestId);
  }
}
