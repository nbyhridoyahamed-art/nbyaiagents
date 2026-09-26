import type { Metadata } from "next";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { AGENT_TEMPLATES } from "@/lib/templates/agents";
import { MODELS } from "@/lib/ai/models";
import { defaultModelFor, listProviderStatus } from "@/server/services/ai-providers";
import { templateToAgentInput } from "@/server/services/agents";
import { HireWizard, type WizardOptions } from "@/components/agents/hire-wizard";
import type { CreateAgentInput } from "@/lib/agents/schema";

export const metadata: Metadata = { title: "Hire AI Employee" };

export default async function NewAgentPage(props: PageProps<"/agents/new">) {
  const ctx = await requirePageContext("agents:write");
  const sp = await props.searchParams;
  const templateKey = typeof sp.template === "string" ? sp.template : undefined;
  const aiPrompt = typeof sp.describe === "string" ? sp.describe.slice(0, 3000) : undefined;
  const mode = sp.mode === "ai" || aiPrompt ? "ai" : templateKey ? "template" : "choose";

  const [departments, knowledgeBases, tools, workflows, providers, defaultModel, policies] = await Promise.all([
    prisma.department.findMany({ where: { orgId: ctx.org.id, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.knowledgeBase.findMany({
      where: { orgId: ctx.org.id, deletedAt: null },
      select: { id: true, name: true, description: true, _count: { select: { documents: { where: { deletedAt: null } } } } },
      orderBy: { name: "asc" },
    }),
    prisma.tool.findMany({
      where: { orgId: ctx.org.id, deletedAt: null, enabled: true },
      select: { id: true, key: true, name: true, description: true, riskLevel: true, capabilities: true, isSimulated: true, kind: true },
      orderBy: { name: "asc" },
    }),
    prisma.workflow.findMany({ where: { orgId: ctx.org.id, deletedAt: null }, select: { id: true, name: true, status: true }, orderBy: { name: "asc" } }),
    listProviderStatus(ctx.org.id),
    defaultModelFor(ctx.org.id),
    prisma.policy.findMany({ where: { orgId: ctx.org.id, scope: "ORGANIZATION", enabled: true }, select: { name: true, rule: true, enforcement: true } }),
  ]);

  const initial: CreateAgentInput | null = templateKey && AGENT_TEMPLATES.some((t) => t.key === templateKey) ? await templateToAgentInput(ctx.org.id, templateKey) : null;

  const options: WizardOptions = {
    departments,
    knowledgeBases: knowledgeBases.map((k) => ({ id: k.id, name: k.name, description: k.description, documents: k._count.documents })),
    tools,
    workflows,
    providers,
    models: MODELS.map((m) => ({ id: m.id, provider: m.provider, label: m.label, description: m.description, recommended: !!m.recommended })),
    defaultModel,
    templates: AGENT_TEMPLATES.map((t) => ({ key: t.key, name: t.suggestedName, jobTitle: t.jobTitle, department: t.department, summary: t.summary, color: t.color })),
    companyPolicies: policies.map((p) => ({ name: p.name, rule: p.rule, enforced: !!p.enforcement })),
  };

  return (
    <PageContainer className="max-w-[1200px]">
      <PageHeader eyebrow="Hire" title="Hire an AI employee" description="Define the role, give them knowledge and tools, and decide exactly what they're allowed to do." />
      <HireWizard key={templateKey ?? mode} options={options} initial={initial} mode={mode} aiPrompt={aiPrompt} />
    </PageContainer>
  );
}
