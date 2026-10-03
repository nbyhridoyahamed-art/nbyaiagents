import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/actor";
import { decryptSecret, encryptSecret, hmacSha256, randomToken, safeEqual } from "@/lib/security/crypto";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { authenticateApiKey } from "@/server/services/api-keys";
import { startWorkflowRun } from "@/server/workflows/engine";
import { writeAudit } from "@/server/services/audit";

/**
 * Inbound workflow webhooks (spec §46). A request is accepted when it carries a
 * valid signature (`X-VDO-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`)
 * or a `workflows:run` API key for the same company. Signatures older than five
 * minutes are rejected so captured requests can't be replayed.
 */

export const SIGNATURE_HEADER = "x-vdo-signature";
const TOLERANCE_SECONDS = 300;
const MAX_BODY_BYTES = 256 * 1024;

export function signWebhookBody(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${hmacSha256(secret, `${timestamp}.${body}`)}`;
}

export function verifyWebhookSignature(secret: string, header: string | null, body: string, now = Date.now()): { ok: boolean; reason?: string } {
  if (!header) return { ok: false, reason: "missing" };
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return { ok: false, reason: "malformed" };
  if (Math.abs(now / 1000 - t) > TOLERANCE_SECONDS) return { ok: false, reason: "expired" };
  return safeEqual(hmacSha256(secret, `${t}.${body}`), parts.v1) ? { ok: true } : { ok: false, reason: "mismatch" };
}

export interface WebhookRequest {
  key: string;
  rawBody: string;
  signature: string | null;
  authorization: string | null;
  deliveryId: string | null;
  ip: string;
}

export async function receiveWebhook(req: WebhookRequest) {
  const hook = await prisma.webhook.findUnique({ where: { key: req.key }, include: { workflow: { select: { id: true, orgId: true, status: true, deletedAt: true, name: true } }, organization: { select: { suspendedAt: true } } } });
  // Unknown and disabled hooks look the same from outside.
  if (!hook || !hook.enabled || hook.workflow.deletedAt || hook.organization.suspendedAt) throw new AppError("NOT_FOUND", "Webhook not found.");

  const limit = await hitRateLimit("webhook", `${hook.id}`);
  if (!limit.allowed) throw new AppError("RATE_LIMITED", "Too many webhook calls. Slow down and retry later.", { details: { resetAt: limit.resetAt.toISOString() } });
  if (req.rawBody.length > MAX_BODY_BYTES) throw new AppError("VALIDATION", "Payload is too large (max 256 KB).");

  // Authenticate: signature or API key.
  let apiKeyId: string | null = null;
  const sig = verifyWebhookSignature(decryptSecret(hook.secretCiphertext), req.signature, req.rawBody);
  if (!sig.ok) {
    if (req.authorization) {
      const principal = await authenticateApiKey(req.authorization);
      if (principal.orgId !== hook.orgId || !principal.scopes.includes("workflows:run")) throw new AppError("FORBIDDEN", "This API key can't run this workflow.");
      apiKeyId = principal.apiKeyId;
    } else if (hook.requireSignature) {
      await writeAudit({ orgId: hook.orgId, actorType: "SYSTEM", action: "webhook.rejected", outcome: "DENIED", entityType: "Webhook", entityId: hook.id, ipAddress: req.ip, metadata: { reason: sig.reason } });
      throw new AppError(
        "UNAUTHENTICATED",
        sig.reason === "expired" ? "The signature timestamp is too old. Sign each request when you send it." : "A valid X-VDO-Signature header or API key is required.",
      );
    }
  }

  if (hook.workflow.status !== "ACTIVE") throw new AppError("CONFLICT", "This workflow isn't active (it's paused or not published).");

  let payload: unknown;
  try {
    payload = req.rawBody.trim() ? JSON.parse(req.rawBody) : {};
  } catch {
    throw new AppError("VALIDATION", "The payload must be JSON.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new AppError("VALIDATION", "The payload must be a JSON object.");

  const delivery = req.deliveryId?.trim().slice(0, 200);
  const run = await startWorkflowRun({
    orgId: hook.orgId,
    workflowId: hook.workflowId,
    trigger: "WEBHOOK",
    payload: payload as Record<string, unknown>,
    mode: "LIVE",
    apiKeyId,
    idempotencyKey: delivery ? `webhook:${hook.id}:${delivery}` : undefined,
  });
  await prisma.webhook.update({ where: { id: hook.id }, data: { lastReceivedAt: new Date() } });
  return { runId: run.id, status: run.status };
}

/** Owners/admins can read the signing secret (e.g. to configure the sender). */
export async function revealWebhookSecret(actor: Actor & { userId: string }, workflowId: string) {
  const hook = await prisma.webhook.findFirst({ where: { workflowId, orgId: actor.orgId } });
  if (!hook) throw notFound("Webhook");
  await writeAudit({ orgId: actor.orgId, actorType: "USER", actorUserId: actor.userId, action: "webhook.secret.reveal", entityType: "Webhook", entityId: hook.id });
  return decryptSecret(hook.secretCiphertext);
}

export async function rotateWebhookSecret(actor: Actor & { userId: string }, workflowId: string) {
  const hook = await prisma.webhook.findFirst({ where: { workflowId, orgId: actor.orgId } });
  if (!hook) throw notFound("Webhook");
  const secret = `whsec_${randomToken(24)}`;
  await prisma.webhook.update({ where: { id: hook.id }, data: { secretCiphertext: encryptSecret(secret) } });
  await writeAudit({ orgId: actor.orgId, actorType: "USER", actorUserId: actor.userId, action: "webhook.secret.rotate", entityType: "Webhook", entityId: hook.id });
  return secret;
}
