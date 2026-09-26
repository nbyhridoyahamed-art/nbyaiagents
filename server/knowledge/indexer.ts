import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { storage } from "@/lib/storage";
import { chunkPages } from "@/lib/knowledge/chunk";
import { cleanText, extractFile, htmlToText } from "@/lib/knowledge/extract";
import { embedTexts } from "@/lib/knowledge/embeddings";
import { safeHttpRequest } from "@/lib/security/ssrf";
import type { KnowledgeFileKind } from "@/lib/security/uploads";
import { recordActivity } from "@/server/services/audit";

/**
 * Knowledge pipeline (spec §19):
 *   Document → Extract → Clean → Chunk → Metadata → Embed → Store → (Retrieve)
 * Runs as a background job; failures are recorded on the document, never hidden.
 */
export async function indexDocument(documentId: string) {
  const doc = await prisma.knowledgeDocument.findUnique({ where: { id: documentId }, include: { file: true } });
  if (!doc || doc.deletedAt) return;
  await prisma.knowledgeDocument.update({ where: { id: doc.id }, data: { status: "PROCESSING", error: null } });

  try {
    let pages: { page: number | null; text: string }[];
    let pageCount: number | null = null;
    let title = doc.title;

    if (doc.sourceType === "UPLOAD") {
      if (!doc.file) throw new Error("The uploaded file is missing.");
      const bytes = await storage().get(doc.file.storageKey);
      const kind = (doc.fileName?.split(".").pop()?.toLowerCase() === "markdown" ? "md" : doc.fileName?.split(".").pop()?.toLowerCase()) as KnowledgeFileKind;
      const extracted = await extractFile(kind, bytes);
      pages = extracted.pages;
      pageCount = extracted.pageCount;
    } else if (doc.sourceType === "MANUAL") {
      pages = [{ page: null, text: doc.content ?? "" }];
    } else if (doc.sourceType === "WEBSITE") {
      if (!doc.sourceUrl) throw new Error("No URL.");
      const res = await safeHttpRequest({ method: "GET", url: doc.sourceUrl, headers: { Accept: "text/html,text/plain" }, allowPrivate: env().ALLOW_PRIVATE_NETWORK_TOOLS, maxBytes: 3 * 1024 * 1024 });
      if (res.status >= 400) throw new Error(`The website returned HTTP ${res.status}.`);
      const isHtml = (res.headers["content-type"] ?? "").includes("html") || /<html|<body/i.test(res.body.slice(0, 2000));
      const { title: pageTitle, text } = isHtml ? htmlToText(res.body) : { title: null, text: res.body };
      if (pageTitle && doc.title === doc.sourceUrl) title = pageTitle.slice(0, 200);
      pages = [{ page: null, text }];
    } else {
      throw new Error(`${doc.sourceType.replace("_", " ").toLowerCase()} sync is not available yet.`);
    }

    const cleaned = pages.map((p) => ({ page: p.page, text: cleanText(p.text) })).filter((p) => p.text.length > 0);
    const totalChars = cleaned.reduce((s, p) => s + p.text.length, 0);
    if (totalChars < 20) throw new Error("No readable text was found. Scanned PDFs need OCR before upload.");

    const chunks = chunkPages(cleaned);
    const vectors: { vector: number[]; model: string }[] = [];
    for (let i = 0; i < chunks.length; i += 64) {
      vectors.push(...(await embedTexts(doc.orgId, chunks.slice(i, i + 64).map((c) => (c.heading ? `${c.heading}\n${c.content}` : c.content)))));
    }
    const model = vectors[0]?.model ?? "unknown";
    const tokenCount = chunks.reduce((s, c) => s + c.tokenCount, 0);

    await prisma.$transaction(async (tx) => {
      await tx.knowledgeChunk.deleteMany({ where: { documentId: doc.id } });
      for (let i = 0; i < chunks.length; i += 200) {
        await tx.knowledgeChunk.createMany({
          data: chunks.slice(i, i + 200).map((c, j) => ({
            orgId: doc.orgId,
            knowledgeBaseId: doc.knowledgeBaseId,
            documentId: doc.id,
            index: c.index,
            content: c.content,
            heading: c.heading,
            pageNumber: c.pageNumber,
            tokenCount: c.tokenCount,
            embedding: vectors[i + j]?.vector ?? [],
            embeddingModel: vectors[i + j]?.model ?? model,
          })),
        });
      }
      await tx.knowledgeDocument.update({
        where: { id: doc.id },
        data: { status: "INDEXED", title, chunkCount: chunks.length, tokenCount, pageCount, embeddingModel: model, indexedAt: new Date(), error: null },
      });
    });
    await prisma.usageRecord.create({ data: { orgId: doc.orgId, kind: "EMBEDDING_TOKENS", inputTokens: tokenCount, model, quantity: chunks.length } });
    await recordActivity({
      orgId: doc.orgId,
      category: "KNOWLEDGE",
      actorType: "SYSTEM",
      summary: `“${title}” indexed.`,
      detail: `${chunks.length} chunks${pageCount ? ` from ${pageCount} pages` : ""}.`,
      entityType: "KnowledgeDocument",
      entityId: doc.id,
      link: `/knowledge/documents/${doc.id}`,
    });
  } catch (err) {
    const message = isAppError(err) ? err.message : String((err as Error)?.message ?? err).slice(0, 500);
    console.error("[knowledge] indexing failed", documentId, message);
    await prisma.knowledgeDocument.update({ where: { id: doc.id }, data: { status: "FAILED", error: message } });
  }
}
