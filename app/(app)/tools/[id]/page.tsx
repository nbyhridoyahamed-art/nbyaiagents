import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { BreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { RiskBadge, SimulatedBadge } from "@/components/tools/risk-badge";
import { RestToolBuilder } from "@/components/tools/rest-tool-builder";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { EFFECT_META } from "@/components/agents/permission-select";
import { CAPABILITIES, type Capability } from "@/lib/policies/types";
import { httpConfigSchema } from "@/lib/tools/http-config";
import { effectiveToolMeta, toolInputJsonSchema } from "@/server/tools/executor";
import { ToolControls } from "./tool-controls";
import { ToolTester } from "./tool-tester";

export const metadata: Metadata = { title: "Tool" };

export default async function ToolPage(props: PageProps<"/tools/[id]">) {
  const ctx = await requirePageContext("tools:read");
  const { id } = await props.params;
  const sp = await props.searchParams;
  const tool = await prisma.tool.findFirst({
    where: { id, orgId: ctx.org.id, deletedAt: null },
    include: { agents: { include: { agent: { select: { id: true, name: true, avatarColor: true, deletedAt: true } } } }, connection: true },
  });
  if (!tool) notFound();
  const meta = effectiveToolMeta(tool);
  const schema = toolInputJsonSchema(tool);
  const canManage = ctx.can("tools:manage");
  const editing = sp.edit === "1" && tool.kind === "CUSTOM_HTTP" && canManage;

  if (editing) {
    const cfg = httpConfigSchema.parse(tool.httpConfig);
    const creds = ctx.can("credentials:manage")
      ? await prisma.toolCredential.findMany({ where: { orgId: ctx.org.id, revokedAt: null }, select: { id: true, name: true, hint: true } })
      : [];
    return (
      <PageContainer className="max-w-[1300px]">
        <BreadcrumbLabel segment={tool.id} label={tool.name} />
        <PageHeader eyebrow={`Editing v${tool.version}`} title={tool.name} description="Saving creates a new tool version. Employees pick it up immediately; permissions still apply." />
        <RestToolBuilder
          credentials={creds}
          initial={{
            toolId: tool.id,
            name: tool.name,
            key: tool.key.replace(/^custom\./, ""),
            description: tool.description,
            riskLevel: tool.riskLevel,
            capabilities: tool.capabilities as Capability[],
            httpConfig: cfg,
          }}
        />
      </PageContainer>
    );
  }

  const example = Object.fromEntries(
    Object.entries((schema.properties ?? {}) as Record<string, { type?: string; enum?: unknown[] }>).map(([k, p]) => [
      k,
      p.enum?.[0] ?? (p.type === "number" || p.type === "integer" ? 1 : p.type === "boolean" ? false : p.type === "array" ? [] : p.type === "object" ? {} : k.includes("email") || k === "to" ? "someone@example.com" : `example ${k}`),
    ]),
  );
  const cfg = tool.kind === "CUSTOM_HTTP" ? httpConfigSchema.parse(tool.httpConfig) : null;

  return (
    <PageContainer className="max-w-[1300px]">
      <BreadcrumbLabel segment={tool.id} label={tool.name} />
      <PageHeader
        eyebrow={tool.kind === "CUSTOM_HTTP" ? "Custom REST API tool" : tool.connection?.name ?? tool.integrationKey ?? "Tool"}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {tool.name} <RiskBadge risk={meta.riskLevel} /> {tool.isSimulated && <SimulatedBadge />}
          </span>
        }
        description={tool.description}
        actions={<ToolControls toolId={tool.id} enabled={tool.enabled} kind={tool.kind} riskLevel={meta.riskLevel} canManage={canManage} canSetRisk={ctx.can("policies:manage")} />}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid content-start gap-6">
          <section className="rounded-xl border bg-surface p-5 shadow-card">
            <h2 className="text-card-title">Definition</h2>
            <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-text-muted">Key</dt>
                <dd className="font-mono text-xs">{tool.key}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Version</dt>
                <dd>v{tool.version}</dd>
              </div>
              {cfg && (
                <div className="sm:col-span-2">
                  <dt className="text-text-muted">Request</dt>
                  <dd className="font-mono text-xs">
                    {cfg.method} {cfg.url} · auth: {cfg.auth.type}
                  </dd>
                </div>
              )}
              <div className="sm:col-span-2">
                <dt className="text-text-muted">Capabilities</dt>
                <dd>{meta.capabilities.length ? meta.capabilities.map((c) => CAPABILITIES[c as Capability] ?? c).join(", ") : "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-text-muted">Last test</dt>
                <dd>{tool.lastTestedAt ? `${tool.lastTestOk ? "Passed" : "Failed"} · ${tool.lastTestedAt.toLocaleString()}` : "Never tested"}</dd>
              </div>
            </dl>
            <h3 className="mt-5 text-[13px] font-semibold">Input schema</h3>
            <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11.5px] leading-5">{JSON.stringify(schema, null, 2)}</pre>
          </section>
          <section className="rounded-xl border bg-surface p-5 shadow-card">
            <h2 className="text-card-title">Employees with access</h2>
            {tool.agents.filter((a) => !a.agent.deletedAt).length === 0 ? (
              <p className="mt-2 text-[13px] text-text-muted">Not granted to anyone yet. Grant it from an employee&apos;s Tools tab.</p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {tool.agents
                  .filter((a) => !a.agent.deletedAt)
                  .map((a) => (
                    <li key={a.id} className="flex items-center gap-2 text-[13.5px]">
                      <AgentAvatar name={a.agent.name} color={a.agent.avatarColor} size={24} />
                      <Link href={`/agents/${a.agent.id}?tab=tools`} className="flex-1 hover:underline">
                        {a.agent.name}
                      </Link>
                      <span className={`text-xs font-medium ${EFFECT_META[a.effect].className}`}>{EFFECT_META[a.effect].label}</span>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>
        {canManage && <ToolTester toolId={tool.id} example={example} readOnly={meta.capabilities.includes("read_only") && !meta.capabilities.some((c) => c !== "read_only" && c !== "sensitive_data")} simulated={tool.isSimulated} />}
      </div>
    </PageContainer>
  );
}
