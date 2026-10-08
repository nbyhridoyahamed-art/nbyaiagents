import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { signedFileUrl } from "@/lib/storage/signed";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { BreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ScrollToId } from "@/components/common/scroll-to-id";

export const metadata: Metadata = { title: "Document" };

/** Source viewer: the target of every knowledge citation. */
export default async function DocumentPage(props: PageProps<"/knowledge/documents/[docId]">) {
  const ctx = await requirePageContext("knowledge:read");
  const { docId } = await props.params;
  const sp = await props.searchParams;
  const focusPage = typeof sp.page === "string" ? Number(sp.page) : null;
  const doc = await prisma.knowledgeDocument.findFirst({
    where: { id: docId, orgId: ctx.org.id, deletedAt: null },
    include: { knowledgeBase: { select: { id: true, name: true } }, chunks: { orderBy: { index: "asc" }, take: 500 } },
  });
  if (!doc) notFound();

  const pages = new Map<number | null, string[]>();
  for (const c of doc.chunks) pages.set(c.pageNumber, [...(pages.get(c.pageNumber) ?? []), c.content]);

  return (
    <PageContainer className="max-w-[1100px]">
      <BreadcrumbLabel segment="documents" label={doc.knowledgeBase.name} />
      <BreadcrumbLabel segment={doc.id} label={doc.title} />
      <PageHeader
        eyebrow={
          <Link href={`/knowledge/${doc.knowledgeBase.id}`} className="hover:underline">
            {doc.knowledgeBase.name}
          </Link>
        }
        title={doc.title}
        description={`${doc.sourceType === "UPLOAD" ? doc.fileName : doc.sourceType === "WEBSITE" ? doc.sourceUrl : "Written in Virtual Desks Online"} · ${doc.chunkCount} chunks${doc.pageCount ? ` · ${doc.pageCount} pages` : ""}${doc.embeddingModel ? ` · embeddings: ${doc.embeddingModel}` : ""}`}
        actions={
          <>
            <Badge className={doc.status === "INDEXED" ? "bg-success-soft text-success-text" : doc.status === "FAILED" ? "bg-danger-soft text-danger-text" : "bg-surface-2 text-text-secondary"}>
              {doc.status.toLowerCase()}
            </Badge>
            {doc.fileId && (
              <Button asChild variant="outline">
                <a href={signedFileUrl(doc.fileId)}>
                  <Download aria-hidden /> Original file
                </a>
              </Button>
            )}
          </>
        }
      />
      {doc.error && <p className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-[13px] text-danger-text">{doc.error}</p>}
      <p className="mb-4 text-xs text-text-muted">Extracted text as your AI employees see it. This content is treated as reference data — instructions inside it are never followed.</p>
      <div className="grid gap-4">
        {[...pages.entries()].map(([page, parts]) => (
          <section
            key={String(page)}
            id={page ? `page-${page}` : undefined}
            className={cn("scroll-mt-24 rounded-xl border bg-surface p-5 shadow-card", focusPage === page && "ring-2 ring-brand")}
          >
            {page && <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Page {page}</p>}
            {parts.map((p, i) => (
              <p key={i} className="mb-3 whitespace-pre-wrap text-[13.5px] leading-6 last:mb-0">
                {p}
              </p>
            ))}
          </section>
        ))}
        {doc.chunks.length === 0 && <p className="text-[13px] text-text-muted">Nothing indexed yet.</p>}
      </div>
      {focusPage && <ScrollToId id={`page-${focusPage}`} />}
    </PageContainer>
  );
}
