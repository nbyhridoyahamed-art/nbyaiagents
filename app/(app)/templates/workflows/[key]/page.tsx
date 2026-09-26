import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { BreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { getWorkflowTemplate } from "@/lib/templates/workflows";
import { getAgentTemplate } from "@/lib/templates/agents";
import { InstallForm } from "./install-form";

export const metadata: Metadata = { title: "Install workflow template" };

export default async function InstallWorkflowTemplatePage(props: PageProps<"/templates/workflows/[key]">) {
  const ctx = await requirePageContext("templates:install");
  const { key } = await props.params;
  const t = getWorkflowTemplate(key);
  if (!t) notFound();
  const agents = await prisma.agent.findMany({
    where: { orgId: ctx.org.id, deletedAt: null },
    select: { id: true, name: true, jobTitle: true, templateKey: true, lifecycle: true },
    orderBy: { name: "asc" },
  });

  return (
    <PageContainer className="max-w-[880px]">
      <BreadcrumbLabel segment={key} label={t.name} />
      <PageHeader eyebrow={`Workflow template · v${t.version}`} title={`Install “${t.name}”`} description={t.summary} />
      <InstallForm
        template={{
          key: t.key,
          name: t.name,
          stages: t.stages,
          roles: t.roles.map((r) => ({ key: r.key, label: r.label, description: r.description, agentTemplate: r.agentTemplate, hireTitle: getAgentTemplate(r.agentTemplate)?.jobTitle ?? "employee" })),
        }}
        agents={agents.map((a) => ({ id: a.id, name: a.name, jobTitle: a.jobTitle, templateKey: a.templateKey, draft: a.lifecycle !== "PUBLISHED" }))}
      />
    </PageContainer>
  );
}
