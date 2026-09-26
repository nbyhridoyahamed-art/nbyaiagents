"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireOrgContext } from "@/lib/auth/context";
import { userActor } from "@/lib/auth/actor";
import {
  addManualDocument,
  addWebSource,
  createKnowledgeBase,
  deleteDocument,
  deleteKnowledgeBase,
  reindexDocument,
  setCollectionAccess,
  updateKnowledgeBase,
  updateManualDocument,
} from "@/server/services/knowledge";
import { searchKnowledge } from "@/server/services/knowledge-search";
import { prisma } from "@/lib/db";

const id = z.string().min(1).max(40);

export async function createCollectionAction(input: { name: string; description?: string; visibility?: "RESTRICTED" | "ORGANIZATION" }): Promise<ActionResult<{ id: string }>> {
  return runAction(
    z.object({ name: z.string().trim().min(2, "Name the collection.").max(80), description: z.string().trim().max(500).optional(), visibility: z.enum(["RESTRICTED", "ORGANIZATION"]).optional() }),
    input,
    async (data) => {
      const ctx = await requireOrgContext("knowledge:write");
      const kb = await createKnowledgeBase(userActor(ctx.org.id, ctx.user.id), data);
      revalidatePath("/knowledge");
      return { id: kb.id };
    },
  );
}

export async function updateCollectionAction(input: { id: string; name?: string; description?: string; visibility?: "RESTRICTED" | "ORGANIZATION" }): Promise<ActionResult> {
  return runAction(
    z.object({ id, name: z.string().trim().min(2).max(80).optional(), description: z.string().trim().max(500).optional(), visibility: z.enum(["RESTRICTED", "ORGANIZATION"]).optional() }),
    input,
    async ({ id: kbId, ...data }) => {
      const ctx = await requireOrgContext("knowledge:write");
      await updateKnowledgeBase(userActor(ctx.org.id, ctx.user.id), kbId, data);
      revalidatePath(`/knowledge/${kbId}`);
    },
  );
}

export async function deleteCollectionAction(kbId: string): Promise<ActionResult> {
  return runAction(id, kbId, async (x) => {
    // Removing a whole collection is an admin-level action.
    const ctx = await requireOrgContext("agents:write");
    await deleteKnowledgeBase(userActor(ctx.org.id, ctx.user.id), x);
    revalidatePath("/knowledge");
  });
}

export async function setCollectionAccessAction(input: { id: string; agentIds: string[]; departmentIds: string[] }): Promise<ActionResult> {
  return runAction(z.object({ id, agentIds: z.array(id).max(200), departmentIds: z.array(id).max(50) }), input, async ({ id: kbId, ...data }) => {
    const ctx = await requireOrgContext("agents:write");
    await setCollectionAccess(userActor(ctx.org.id, ctx.user.id), kbId, data);
    revalidatePath(`/knowledge/${kbId}`);
  });
}

export async function addManualDocumentAction(input: { knowledgeBaseId: string; title: string; content: string }): Promise<ActionResult> {
  return runAction(
    z.object({ knowledgeBaseId: id, title: z.string().trim().min(2, "Give it a title.").max(200), content: z.string().trim().min(20, "Write at least a couple of sentences.").max(500_000) }),
    input,
    async (data) => {
      const ctx = await requireOrgContext("knowledge:write");
      await addManualDocument(userActor(ctx.org.id, ctx.user.id), data.knowledgeBaseId, data);
      revalidatePath(`/knowledge/${data.knowledgeBaseId}`);
    },
  );
}

export async function updateManualDocumentAction(input: { documentId: string; title: string; content: string }): Promise<ActionResult> {
  return runAction(z.object({ documentId: id, title: z.string().trim().min(2).max(200), content: z.string().trim().min(20).max(500_000) }), input, async (data) => {
    const ctx = await requireOrgContext("knowledge:write");
    await updateManualDocument(userActor(ctx.org.id, ctx.user.id), data.documentId, data);
    revalidatePath(`/knowledge/documents/${data.documentId}`);
  });
}

export async function addWebSourceAction(input: { knowledgeBaseId: string; url: string; kind: "WEBSITE" | "SITEMAP" }): Promise<ActionResult<{ pages: number }>> {
  return runAction(z.object({ knowledgeBaseId: id, url: z.string().trim().url("Enter a full URL, including https://").max(2000), kind: z.enum(["WEBSITE", "SITEMAP"]) }), input, async (data) => {
    const ctx = await requireOrgContext("knowledge:write");
    const docs = await addWebSource(userActor(ctx.org.id, ctx.user.id), data.knowledgeBaseId, data.url, data.kind);
    revalidatePath(`/knowledge/${data.knowledgeBaseId}`);
    return { pages: docs.length };
  });
}

export async function reindexDocumentAction(documentId: string): Promise<ActionResult> {
  return runAction(id, documentId, async (x) => {
    const ctx = await requireOrgContext("knowledge:write");
    await reindexDocument(userActor(ctx.org.id, ctx.user.id), x);
  });
}

export async function deleteDocumentAction(documentId: string): Promise<ActionResult> {
  return runAction(id, documentId, async (x) => {
    const ctx = await requireOrgContext("knowledge:write");
    await deleteDocument(userActor(ctx.org.id, ctx.user.id), x);
  });
}

export interface SearchPreviewHit {
  documentId: string;
  title: string;
  page: number | null;
  excerpt: string;
  score: number;
  collection: string;
}

/** "What would an employee find?" — searches the chosen collections (or all) for the owner. */
export async function searchPreviewAction(input: { query: string; knowledgeBaseIds?: string[] }): Promise<ActionResult<SearchPreviewHit[]>> {
  return runAction(z.object({ query: z.string().trim().min(2).max(300), knowledgeBaseIds: z.array(id).max(100).optional() }), input, async (data) => {
    const ctx = await requireOrgContext("knowledge:read");
    const kbs = await prisma.knowledgeBase.findMany({
      where: { orgId: ctx.org.id, deletedAt: null, ...(data.knowledgeBaseIds?.length ? { id: { in: data.knowledgeBaseIds } } : {}) },
      select: { id: true, name: true },
    });
    const hits = await searchKnowledge(ctx.org.id, kbs.map((k) => k.id), data.query, 8);
    return hits.map((h) => ({
      documentId: h.documentId,
      title: h.title,
      page: h.pageNumber,
      excerpt: h.content.slice(0, 400),
      score: Math.round(h.score * 100) / 100,
      collection: kbs.find((k) => k.id === h.knowledgeBaseId)?.name ?? "",
    }));
  });
}
