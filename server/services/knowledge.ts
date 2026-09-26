import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError, notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/actor";
import { storage, storageKey } from "@/lib/storage";
import { CANONICAL_MIME, validateKnowledgeUpload } from "@/lib/security/uploads";
import { assertSafeUrl, safeHttpRequest } from "@/lib/security/ssrf";
import { sitemapUrls } from "@/lib/knowledge/extract";
import { enqueue } from "@/server/jobs/queue";
import { writeAudit } from "@/server/services/audit";

export async function createKnowledgeBase(actor: Actor, input: { name: string; description?: string; category?: string; visibility?: "RESTRICTED" | "ORGANIZATION" }) {
  const kb = await prisma.knowledgeBase.create({
    data: {
      orgId: actor.orgId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      category: input.category || null,
      visibility: input.visibility ?? "RESTRICTED",
      createdById: actor.userId ?? null,
    },
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "knowledge.collection.create", entityType: "KnowledgeBase", entityId: kb.id });
  return kb;
}

export async function getKnowledgeBase(orgId: string, id: string) {
  const kb = await prisma.knowledgeBase.findFirst({ where: { id, orgId, deletedAt: null } });
  if (!kb) throw notFound("Knowledge collection");
  return kb;
}

export async function updateKnowledgeBase(actor: Actor, id: string, input: { name?: string; description?: string; visibility?: "RESTRICTED" | "ORGANIZATION" }) {
  await getKnowledgeBase(actor.orgId, id);
  await prisma.knowledgeBase.update({ where: { id }, data: { name: input.name?.trim(), description: input.description, visibility: input.visibility } });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "knowledge.collection.update", entityType: "KnowledgeBase", entityId: id, metadata: input });
}

/** Deletes a collection: documents become unavailable immediately and their chunks are removed. */
export async function deleteKnowledgeBase(actor: Actor, id: string) {
  await getKnowledgeBase(actor.orgId, id);
  await prisma.$transaction([
    prisma.knowledgeChunk.deleteMany({ where: { knowledgeBaseId: id } }),
    prisma.knowledgeAssignment.deleteMany({ where: { knowledgeBaseId: id } }),
    prisma.knowledgeDocument.updateMany({ where: { knowledgeBaseId: id }, data: { deletedAt: new Date() } }),
    prisma.knowledgeBase.update({ where: { id }, data: { deletedAt: new Date() } }),
  ]);
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "knowledge.collection.delete", entityType: "KnowledgeBase", entityId: id });
}

export async function setCollectionAccess(actor: Actor, id: string, input: { agentIds: string[]; departmentIds: string[] }) {
  await getKnowledgeBase(actor.orgId, id);
  const [agents, depts] = await Promise.all([
    prisma.agent.count({ where: { orgId: actor.orgId, id: { in: input.agentIds }, deletedAt: null } }),
    prisma.department.count({ where: { orgId: actor.orgId, id: { in: input.departmentIds }, deletedAt: null } }),
  ]);
  if (agents !== new Set(input.agentIds).size || depts !== new Set(input.departmentIds).size) throw new AppError("VALIDATION", "Some selections are no longer available.");
  await prisma.$transaction([
    prisma.knowledgeAssignment.deleteMany({ where: { knowledgeBaseId: id } }),
    prisma.knowledgeAssignment.createMany({
      data: [
        ...input.agentIds.map((agentId) => ({ orgId: actor.orgId, knowledgeBaseId: id, agentId })),
        ...input.departmentIds.map((departmentId) => ({ orgId: actor.orgId, knowledgeBaseId: id, departmentId })),
      ],
    }),
  ]);
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "knowledge.access.update", entityType: "KnowledgeBase", entityId: id, metadata: input });
}

async function queueIndex(orgId: string, documentId: string) {
  await enqueue("knowledge.index", { documentId }, { orgId, dedupeKey: `index:${documentId}:${Date.now()}` });
}

export async function uploadDocument(actor: Actor, knowledgeBaseId: string, file: File) {
  await getKnowledgeBase(actor.orgId, knowledgeBaseId);
  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = validateKnowledgeUpload({ name: file.name, type: file.type, size: file.size }, bytes);
  const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
  const dup = await prisma.knowledgeDocument.findFirst({ where: { orgId: actor.orgId, knowledgeBaseId, checksum, deletedAt: null } });
  if (dup) throw new AppError("CONFLICT", `“${file.name}” is already in this collection.`);

  const fileId = crypto.randomUUID();
  const key = storageKey(actor.orgId, "knowledge", fileId, file.name);
  await storage().put(key, bytes, CANONICAL_MIME[kind]);
  const stored = await prisma.storedFile.create({
    data: { orgId: actor.orgId, storageKey: key, fileName: file.name.slice(0, 200), mimeType: CANONICAL_MIME[kind], size: bytes.length, checksum, purpose: "knowledge", createdById: actor.userId ?? null },
  });
  const doc = await prisma.knowledgeDocument.create({
    data: {
      orgId: actor.orgId,
      knowledgeBaseId,
      title: file.name.replace(/\.[^.]+$/, "").slice(0, 200),
      sourceType: "UPLOAD",
      mimeType: CANONICAL_MIME[kind],
      fileName: file.name.slice(0, 200),
      fileSize: bytes.length,
      fileId: stored.id,
      checksum,
      createdById: actor.userId ?? null,
    },
  });
  await prisma.usageRecord.create({ data: { orgId: actor.orgId, kind: "STORAGE_BYTES", quantity: bytes.length } });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "knowledge.document.upload", entityType: "KnowledgeDocument", entityId: doc.id, metadata: { fileName: file.name, size: bytes.length } });
  await queueIndex(actor.orgId, doc.id);
  return doc;
}

export async function addManualDocument(actor: Actor, knowledgeBaseId: string, input: { title: string; content: string }) {
  await getKnowledgeBase(actor.orgId, knowledgeBaseId);
  const doc = await prisma.knowledgeDocument.create({
    data: {
      orgId: actor.orgId,
      knowledgeBaseId,
      title: input.title.trim().slice(0, 200),
      sourceType: "MANUAL",
      content: input.content.slice(0, 500_000),
      checksum: crypto.createHash("sha256").update(input.content).digest("hex"),
      createdById: actor.userId ?? null,
    },
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "knowledge.document.create", entityType: "KnowledgeDocument", entityId: doc.id });
  await queueIndex(actor.orgId, doc.id);
  return doc;
}

export async function updateManualDocument(actor: Actor, documentId: string, input: { title: string; content: string }) {
  const doc = await prisma.knowledgeDocument.findFirst({ where: { id: documentId, orgId: actor.orgId, deletedAt: null } });
  if (!doc) throw notFound("Document");
  if (doc.sourceType !== "MANUAL") throw new AppError("VALIDATION", "Only written documents can be edited here. Re-upload files instead.");
  await prisma.knowledgeDocument.update({ where: { id: documentId }, data: { title: input.title.trim(), content: input.content, status: "PENDING" } });
  await queueIndex(actor.orgId, documentId);
}

/** Adds a web page — or every page listed in a sitemap (max 25). */
export async function addWebSource(actor: Actor, knowledgeBaseId: string, url: string, kind: "WEBSITE" | "SITEMAP") {
  await getKnowledgeBase(actor.orgId, knowledgeBaseId);
  assertSafeUrl(url, env().ALLOW_PRIVATE_NETWORK_TOOLS);
  let urls = [url];
  if (kind === "SITEMAP") {
    const res = await safeHttpRequest({ method: "GET", url, allowPrivate: env().ALLOW_PRIVATE_NETWORK_TOOLS, maxBytes: 2 * 1024 * 1024 });
    if (res.status >= 400) throw new AppError("INTEGRATION_ERROR", `The sitemap returned HTTP ${res.status}.`);
    urls = sitemapUrls(res.body, 25);
    if (!urls.length) throw new AppError("VALIDATION", "No page URLs were found in that sitemap.");
  }
  const docs = [];
  for (const u of urls) {
    try {
      assertSafeUrl(u, env().ALLOW_PRIVATE_NETWORK_TOOLS);
    } catch {
      continue;
    }
    const doc = await prisma.knowledgeDocument.create({
      data: { orgId: actor.orgId, knowledgeBaseId, title: u.slice(0, 200), sourceType: "WEBSITE", sourceUrl: u, createdById: actor.userId ?? null },
    });
    docs.push(doc);
    await queueIndex(actor.orgId, doc.id);
  }
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "knowledge.web.add", entityType: "KnowledgeBase", entityId: knowledgeBaseId, metadata: { url, kind, pages: docs.length } });
  return docs;
}

export async function reindexDocument(actor: Actor, documentId: string) {
  const doc = await prisma.knowledgeDocument.findFirst({ where: { id: documentId, orgId: actor.orgId, deletedAt: null } });
  if (!doc) throw notFound("Document");
  await prisma.knowledgeDocument.update({ where: { id: documentId }, data: { status: "PENDING", error: null } });
  await queueIndex(actor.orgId, documentId);
}

/** Deleting a document removes its chunks at once, so agents can never retrieve it again. */
export async function deleteDocument(actor: Actor, documentId: string) {
  const doc = await prisma.knowledgeDocument.findFirst({ where: { id: documentId, orgId: actor.orgId, deletedAt: null }, include: { file: true } });
  if (!doc) throw notFound("Document");
  await prisma.$transaction([
    prisma.knowledgeChunk.deleteMany({ where: { documentId } }),
    prisma.knowledgeDocument.update({ where: { id: documentId }, data: { deletedAt: new Date() } }),
  ]);
  if (doc.file) {
    await storage().delete(doc.file.storageKey).catch(() => {});
    await prisma.storedFile.delete({ where: { id: doc.file.id } }).catch(() => {});
  }
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "knowledge.document.delete", entityType: "KnowledgeDocument", entityId: documentId, metadata: { title: doc.title } });
}
