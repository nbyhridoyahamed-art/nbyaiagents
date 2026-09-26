import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { BreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { getDraft, getWorkflow, validateDraft } from "@/server/services/workflows";
import { effectiveToolMeta, toolInputJsonSchema } from "@/server/tools/executor";
import type { EditorOptions } from "@/components/workflows/editor-types";
import { WorkflowEditorLoader } from "./editor-loader";

export const metadata: Metadata = { title: "Workflow builder" };

export default async function WorkflowEditorPage(props: PageProps<"/workflows/[id]">) {
  const ctx = await requirePageContext("workflows:read");
  const { id } = await props.params;
  let workflow;
  try {
    workflow = await getWorkflow(ctx.org.id, id);
  } catch (err) {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const [{ graph, settings, version }, agents, tools, runs, webhook] = await Promise.all([
    getDraft(ctx.org.id, id),
    prisma.agent.findMany({ where: { orgId: ctx.org.id, deletedAt: null }, select: { id: true, name: true, jobTitle: true, lifecycle: true, avatarColor: true, status: true }, orderBy: { name: "asc" } }),
    prisma.tool.findMany({ where: { orgId: ctx.org.id, deletedAt: null }, orderBy: [{ integrationKey: "asc" }, { name: "asc" }] }),
    prisma.workflowRun.findMany({ where: { workflowId: id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, status: true, mode: true, createdAt: true, version: true } }),
    prisma.webhook.findFirst({ where: { workflowId: id }, select: { key: true, enabled: true } }),
  ]);
  const { issues } = await validateDraft(ctx.org.id, id, false);

  const options: EditorOptions = {
    agents: agents.map((a) => ({ id: a.id, name: a.name, jobTitle: a.jobTitle, published: a.lifecycle === "PUBLISHED", color: a.avatarColor, paused: a.status === "PAUSED" })),
    tools: tools.map((t) => {
      const schema = toolInputJsonSchema(t) as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
      return {
        key: t.key,
        name: t.name,
        riskLevel: effectiveToolMeta(t).riskLevel,
        simulated: t.isSimulated,
        enabled: t.enabled,
        fields: Object.entries(schema.properties ?? {}).map(([name, p]) => ({ name, type: p.type ?? "string", description: p.description ?? "", required: (schema.required ?? []).includes(name) })),
      };
    }),
  };

  return (
    <>
      <BreadcrumbLabel segment={workflow.id} label={workflow.name} />
      <WorkflowEditorLoader
        workflow={{
          id: workflow.id,
          name: workflow.name,
          description: workflow.description ?? "",
          status: workflow.status,
          publishedVersion: workflow.publishedVersion,
          draftVersion: version.version,
          draftIsPublished: version.status !== "DRAFT",
          lastSimulationOk: !!version.lastSimulationOk,
        }}
        graph={graph}
        settings={settings}
        options={options}
        initialIssues={issues}
        runs={runs.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
        webhookUrl={webhook ? `${env().APP_URL}/api/webhooks/${webhook.key}` : null}
        webhookEnabled={webhook?.enabled ?? false}
        permissions={{ write: ctx.can("workflows:write"), publish: ctx.can("workflows:publish"), run: ctx.can("workflows:run") }}
        autoOpenRun={(await props.searchParams).run === "1"}
      />
    </>
  );
}
