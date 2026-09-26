import type { Metadata } from "next";
import Link from "next/link";
import { LayoutTemplate, PenLine, Sparkles } from "lucide-react";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { cn } from "@/lib/utils";
import { NewWorkflowForm } from "./new-workflow-form";
import { DescribeWorkflow } from "./describe-workflow";

export const metadata: Metadata = { title: "Create workflow" };

export default async function NewWorkflowPage(props: PageProps<"/workflows/new">) {
  const ctx = await requirePageContext("workflows:write");
  const sp = await props.searchParams;
  const describe = typeof sp.describe === "string" ? sp.describe.slice(0, 4000) : undefined;
  const mode = describe || sp.mode === "describe" ? "describe" : "blank";
  const departments = await prisma.department.findMany({ where: { orgId: ctx.org.id, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const tabs = [
    { key: "describe", label: "Describe it", icon: Sparkles, href: "/workflows/new?mode=describe" },
    { key: "template", label: "From a template", icon: LayoutTemplate, href: "/templates?tab=workflows" },
    { key: "blank", label: "Start blank", icon: PenLine, href: "/workflows/new" },
  ];
  return (
    <PageContainer className="max-w-[880px]">
      <PageHeader eyebrow="Workflows" title="Create a workflow" description="Describe it in plain language, start from a template, or build it step by step. Nothing runs until you test and publish it." />
      <nav aria-label="How to start" className="mb-5 inline-flex flex-wrap rounded-xl border bg-surface p-1">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={mode === t.key ? "page" : undefined}
            className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium", mode === t.key ? "bg-brand-soft text-brand-hover" : "text-text-secondary hover:bg-surface-2")}
          >
            <t.icon className="size-4" aria-hidden /> {t.label}
          </Link>
        ))}
      </nav>
      {mode === "describe" ? <DescribeWorkflow initial={describe} /> : <NewWorkflowForm departments={departments} />}
    </PageContainer>
  );
}
