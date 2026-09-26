import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, ChevronRight, RefreshCw, ShieldCheck, Users, Workflow } from "lucide-react";
import { requirePageContext } from "@/lib/auth/context";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { AGENT_TEMPLATES } from "@/lib/templates/agents";
import { WORKFLOW_TEMPLATES, getWorkflowTemplate } from "@/lib/templates/workflows";
import { getIntegration } from "@/lib/integrations/catalog";
import { getToolDefinition } from "@/lib/tools/registry";
import { getTemplateUsage, type TemplateUsage } from "@/server/services/templates";
import { getDisabled } from "@/server/services/platform-settings";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Templates" };

const EFFECT_STYLE = {
  ALLOW: "bg-success-soft text-success-text",
  REQUIRE_APPROVAL: "bg-warning-soft text-warning-text",
  DENY: "bg-danger-soft text-danger-text",
} as const;
const EFFECT_LABEL = { ALLOW: "allowed", REQUIRE_APPROVAL: "needs approval", DENY: "blocked" } as const;

function toolName(key: string) {
  return getToolDefinition(key)?.name ?? key.split(".").pop()!.replace(/_/g, " ");
}

function UsageLine({ usage, noun, kind }: { usage: TemplateUsage; noun: string; kind: "agents" | "workflows" }) {
  if (!usage.count) return null;
  const first = usage.items[0];
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
      <span>
        In use:{" "}
        <Link href={kind === "agents" ? `/agents/${first.id}` : `/workflows/${first.id}`} className="text-brand hover:underline">
          {first.name}
        </Link>
        {usage.count > 1 && ` +${usage.count - 1} more ${noun}`}
      </span>
      {usage.outdated > 0 && (
        <span className="inline-flex items-center gap-1 rounded bg-info-soft px-1.5 py-0.5 font-medium text-info-text">
          <RefreshCw className="size-3" aria-hidden /> Newer template version available
        </span>
      )}
    </p>
  );
}

export default async function TemplatesPage(props: PageProps<"/templates">) {
  const ctx = await requirePageContext();
  const sp = await props.searchParams;
  const tab = sp.tab === "workflows" ? "workflows" : "employees";
  const [usage, disabled] = await Promise.all([getTemplateUsage(ctx.org.id), getDisabled("templates.disabled")]);
  // Templates a platform admin switched off aren't offered.
  const agentTemplates = AGENT_TEMPLATES.filter((t) => !disabled.includes(t.key));
  const workflowTemplates = WORKFLOW_TEMPLATES.filter((t) => !disabled.includes(t.key));
  const canInstall = ctx.can("templates:install");

  return (
    <PageContainer>
      <PageHeader
        title="Templates"
        description="Start from a proven setup, then make it yours. Templates install as drafts — you review, test and publish them before any real work happens."
      />
      <nav aria-label="Template type" className="mb-6 inline-flex rounded-xl border bg-surface p-1">
        {[
          { key: "employees", label: `AI Employees (${agentTemplates.length})`, icon: Users },
          { key: "workflows", label: `Workflows (${workflowTemplates.length})`, icon: Workflow },
        ].map((t) => (
          <Link
            key={t.key}
            href={`/templates${t.key === "workflows" ? "?tab=workflows" : ""}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium", tab === t.key ? "bg-brand-soft text-brand-hover" : "text-text-secondary hover:bg-surface-2")}
          >
            <t.icon className="size-4" aria-hidden /> {t.label}
          </Link>
        ))}
      </nav>

      {tab === "employees" ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {agentTemplates.map((t) => (
            <article key={t.key} className="flex flex-col rounded-[14px] border bg-surface p-5 shadow-card">
              <div className="flex items-start gap-3">
                <AgentAvatar name={t.suggestedName} color={t.color} size={44} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-card-title">{t.jobTitle}</h2>
                  <p className="text-xs text-text-muted">
                    {t.department} · suggested name {t.suggestedName} · v{t.version}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-[13.5px] text-text-secondary">{t.summary}</p>
              <details className="group mt-3 text-[13px]">
                <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-brand">
                  <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden /> What&apos;s included
                </summary>
                <div className="mt-2 grid gap-3">
                  <div>
                    <p className="text-xs font-semibold text-text-muted">Role</p>
                    <p>{t.mission}</p>
                    <ul className="mt-1 list-disc pl-5 text-text-secondary">
                      {t.responsibilities.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="flex items-center gap-1 text-xs font-semibold text-text-muted">
                      <ShieldCheck className="size-3.5" aria-hidden /> Tools & recommended permissions
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {t.suggestedTools.map((s) => (
                        <li key={s.toolKey} className={cn("rounded-md px-1.5 py-0.5 text-[11.5px] font-medium", EFFECT_STYLE[s.effect])}>
                          {toolName(s.toolKey)} · {EFFECT_LABEL[s.effect]}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {t.suggestedKnowledge.length > 0 && (
                    <div>
                      <p className="flex items-center gap-1 text-xs font-semibold text-text-muted">
                        <BookOpen className="size-3.5" aria-hidden /> Suggested knowledge
                      </p>
                      <p className="text-text-secondary">{t.suggestedKnowledge.join(", ")}</p>
                    </div>
                  )}
                  {t.suggestedWorkflows.length > 0 && (
                    <div>
                      <p className="flex items-center gap-1 text-xs font-semibold text-text-muted">
                        <Workflow className="size-3.5" aria-hidden /> Works well with
                      </p>
                      <p className="text-text-secondary">
                        {t.suggestedWorkflows.map((k, i) => {
                          const wt = getWorkflowTemplate(k);
                          return (
                            <span key={k}>
                              {i > 0 && ", "}
                              {wt ? (
                                <Link href={`/templates/workflows/${wt.key}`} className="text-brand hover:underline">
                                  {wt.name}
                                </Link>
                              ) : (
                                k.replace(/-/g, " ")
                              )}
                            </span>
                          );
                        })}
                      </p>
                    </div>
                  )}
                </div>
              </details>
              <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-4">
                <UsageLine usage={usage.agents[t.key]} noun="employees" kind="agents" />
                {canInstall && ctx.can("agents:write") && (
                  <Button asChild size="sm" className="ml-auto">
                    <Link href={`/agents/new?template=${t.key}`}>
                      Use template <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {workflowTemplates.map((t) => (
            <article key={t.key} className="flex flex-col rounded-[14px] border bg-surface p-5 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-eyebrow text-brand">{t.category}</p>
                  <h2 className="text-card-title">{t.name}</h2>
                </div>
                <span className="text-xs text-text-muted">v{t.version}</span>
              </div>
              <p className="mt-2 text-[13.5px] text-text-secondary">{t.summary}</p>
              <ol className="mt-4 flex flex-wrap items-center gap-1.5 text-[12px]" aria-label="Steps">
                {t.stages.map((s, i) => (
                  <li key={s} className="flex items-center gap-1.5">
                    {i > 0 && <ArrowRight className="size-3 text-text-muted" aria-hidden />}
                    <span className="rounded-md border bg-surface-2 px-2 py-0.5 font-medium">{s}</span>
                  </li>
                ))}
              </ol>
              <dl className="mt-4 grid gap-2 text-[13px] sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold text-text-muted">Employees</dt>
                  <dd>{t.roles.map((r) => r.label).join(", ")}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-text-muted">Integrations</dt>
                  <dd>{t.integrations.map((i) => getIntegration(i)?.name ?? i).join(", ")}</dd>
                </div>
              </dl>
              <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-4">
                <UsageLine usage={usage.workflows[t.key]} noun="workflows" kind="workflows" />
                {canInstall && ctx.can("workflows:write") && (
                  <Button asChild size="sm" className="ml-auto">
                    <Link href={`/templates/workflows/${t.key}`}>
                      Install <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
