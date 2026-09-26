import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import type { CredentialType } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/lib/auth/actor";
import { encryptSecret, secretHint } from "@/lib/security/crypto";
import { writeAudit } from "@/server/services/audit";

/**
 * Secrets (spec §26): encrypted at rest, write-only from the UI. Plaintext is
 * never returned to the browser, logged, exported or put in model context.
 */

export const credentialPublicSelect = {
  id: true,
  name: true,
  type: true,
  hint: true,
  createdAt: true,
  rotatedAt: true,
  lastUsedAt: true,
  revokedAt: true,
} as const;

export async function listCredentials(orgId: string) {
  return prisma.toolCredential.findMany({
    where: { orgId },
    select: { ...credentialPublicSelect, _count: { select: { tools: true, connections: true, providers: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function createCredential(actor: Actor, input: { name: string; type: CredentialType; secret: string }) {
  const secret = input.secret.trim();
  if (secret.length < 4) throw new AppError("VALIDATION", "The secret looks too short.", { fieldErrors: { secret: "Paste the full secret." } });
  if (input.type === "BASIC_AUTH" && !secret.includes(":")) {
    throw new AppError("VALIDATION", "Basic auth secrets use the format username:password.", { fieldErrors: { secret: "Use username:password." } });
  }
  const cred = await prisma.toolCredential.create({
    data: { orgId: actor.orgId, name: input.name.trim(), type: input.type, ciphertext: encryptSecret(secret), hint: secretHint(secret), createdById: actor.userId ?? null },
    select: credentialPublicSelect,
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "credential.create", entityType: "ToolCredential", entityId: cred.id, metadata: { name: cred.name, type: cred.type } });
  return cred;
}

export async function rotateCredential(actor: Actor, id: string, secret: string) {
  const cred = await prisma.toolCredential.findFirst({ where: { id, orgId: actor.orgId } });
  if (!cred) throw notFound("Credential");
  if (secret.trim().length < 4) throw new AppError("VALIDATION", "The secret looks too short.");
  await prisma.toolCredential.update({
    where: { id },
    data: { ciphertext: encryptSecret(secret.trim()), hint: secretHint(secret.trim()), rotatedAt: new Date(), revokedAt: null },
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "credential.rotate", entityType: "ToolCredential", entityId: id });
}

/** Revocation is immediate: tools and providers using it stop working. */
export async function revokeCredential(actor: Actor, id: string) {
  const cred = await prisma.toolCredential.findFirst({ where: { id, orgId: actor.orgId } });
  if (!cred) throw notFound("Credential");
  await prisma.toolCredential.update({ where: { id }, data: { revokedAt: new Date(), ciphertext: encryptSecret("revoked") } });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "credential.revoke", entityType: "ToolCredential", entityId: id });
}
