import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { BreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import { CollectionView } from "./collection-view";
import { SearchPreview } from "../search-preview";

export const metadata: Metadata = { title: "Knowledge collection" };

export default async function CollectionPage(props: PageProps<"/knowledge/[id]">) {
  const ctx = await requirePageContext("knowledge:read");
  const { id } = await props.params;
  const kb = await prisma.knowledgeBase.findFirst({
    where: { id, orgId: ctx.org.id, deletedAt: null },
    include: { assignments: true },
  });
  if (!kb) notFound();
  const [documents, agents, departments] = await Promise.all([
    prisma.knowledgeDocument.findMany({ where: { knowledgeBaseId: id, deletedAt: null }, orderBy: { createdAt: "desc" } }),
    prisma.agent.findMany({ where: { orgId: ctx.org.id, deletedAt: null }, select: { id: true, name: true, jobTitle: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { orgId: ctx.org.id, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <PageContainer>
      <BreadcrumbLabel segment={kb.id} label={kb.name} />
      <PageHeader eyebrow="Knowledge collection" title={kb.name} description={kb.description ?? undefined} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <CollectionView
          canWrite={ctx.can("knowledge:write")}
          canManageAccess={ctx.can("agents:write")}
          collection={{ id: kb.id, name: kb.name, description: kb.description ?? "", visibility: kb.visibility }}
          access={{ agentIds: kb.assignments.filter((a) => a.agentId).map((a) => a.agentId!), departmentIds: kb.assignments.filter((a) => a.departmentId).map((a) => a.departmentId!) }}
          agents={agents}
          departments={departments}
          externalSources={INTEGRATIONS.filter((i) => ["google_drive", "notion", "dropbox"].includes(i.key)).map((i) => ({ key: i.key, name: i.name, availability: i.availability }))}
          documents={documents.map((d) => ({
            id: d.id,
            title: d.title,
            sourceType: d.sourceType,
            fileName: d.fileName,
            sourceUrl: d.sourceUrl,
            status: d.status,
            error: d.error,
            chunkCount: d.chunkCount,
            pageCount: d.pageCount,
            fileSize: d.fileSize,
            embeddingModel: d.embeddingModel,
            updatedAt: d.updatedAt.toISOString(),
          }))}
        />
        <SearchPreview knowledgeBaseIds={[kb.id]} />
      </div>
    </PageContainer>
  );
}
