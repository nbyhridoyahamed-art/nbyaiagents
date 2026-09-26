import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Globe, Lock } from "lucide-react";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { EmptyState } from "@/components/common/empty-state";
import { NewCollectionDialog } from "./new-collection-dialog";
import { SearchPreview } from "./search-preview";

export const metadata: Metadata = { title: "Knowledge" };

export default async function KnowledgePage(props: PageProps<"/knowledge">) {
  // ?search=1 (command palette "Search Knowledge") focuses the search box.
  const focusSearch = (await props.searchParams).search === "1";
  const ctx = await requirePageContext("knowledge:read");
  const [collections, statusCounts] = await Promise.all([
    prisma.knowledgeBase.findMany({
      where: { orgId: ctx.org.id, deletedAt: null },
      include: {
        _count: { select: { documents: { where: { deletedAt: null } } } },
        assignments: { include: { agent: { select: { name: true } }, department: { select: { name: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.knowledgeDocument.groupBy({ by: ["knowledgeBaseId", "status"], where: { orgId: ctx.org.id, deletedAt: null }, _count: true }),
  ]);
  const canWrite = ctx.can("knowledge:write");

  return (
    <PageContainer>
      <PageHeader
        title="Knowledge"
        description="Approved company knowledge your AI employees can search — with citations. Each collection is only readable by the employees and departments you allow."
        actions={canWrite && <NewCollectionDialog />}
      />
      {collections.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Your AI employees need knowledge."
          description="Add policies, documents or product information."
          action={canWrite && <NewCollectionDialog label="Add Knowledge" />}
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <ul className="grid content-start gap-4 sm:grid-cols-2">
            {collections.map((c) => {
              const counts = statusCounts.filter((s) => s.knowledgeBaseId === c.id);
              const indexed = counts.find((s) => s.status === "INDEXED")?._count ?? 0;
              const failed = counts.find((s) => s.status === "FAILED")?._count ?? 0;
              const total = c._count.documents;
              const access =
                c.visibility === "ORGANIZATION"
                  ? "Everyone"
                  : c.assignments.map((a) => a.agent?.name ?? a.department?.name).filter(Boolean).join(", ") || "No one yet";
              return (
                <li key={c.id}>
                  <Link href={`/knowledge/${c.id}`} className="flex h-full flex-col rounded-xl border bg-surface p-5 shadow-card transition-all hover:-translate-y-px hover:shadow-card-hover">
                    <div className="flex items-start gap-3">
                      <span className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
                        <BookOpen className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="text-card-title">{c.name}</p>
                        <p className="line-clamp-2 text-[13px] text-text-secondary">{c.description || "No description"}</p>
                      </div>
                    </div>
                    <div className="mt-auto pt-4 text-xs text-text-muted">
                      <p>
                        {total} document{total === 1 ? "" : "s"} · {total ? `${Math.round((indexed / total) * 100)}% indexed` : "empty"}
                        {failed > 0 && <span className="text-danger-text"> · {failed} failed</span>}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 truncate">
                        {c.visibility === "ORGANIZATION" ? <Globe className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />}
                        Access: {access}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <SearchPreview autoFocus={focusSearch} />
        </div>
      )}
    </PageContainer>
  );
}
