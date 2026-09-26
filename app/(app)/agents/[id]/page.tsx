import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { PageContainer } from "@/components/layout/page";
import { BreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { getAgent, validateAgent } from "@/server/services/agents";
import { cn } from "@/lib/utils";
import { AgentHeader } from "./agent-header";
import { OverviewTab } from "./tabs/overview-tab";
import { SettingsTab } from "./tabs/settings-tab";
import { ToolsTab } from "./tabs/tools-tab";
import { KnowledgeTab } from "./tabs/knowledge-tab";
import { WorkflowsTab } from "./tabs/workflows-tab";
import { MemoryTab } from "./tabs/memory-tab";
import { ActivityTab } from "./tabs/activity-tab";
import { ChatTab } from "./tabs/chat-tab";
import { TasksTab } from "./tabs/tasks-tab";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "chat", label: "Chat" },
  { key: "tasks", label: "Tasks" },
  { key: "knowledge", label: "Knowledge" },
  { key: "tools", label: "Tools" },
  { key: "workflows", label: "Workflows" },
  { key: "memory", label: "Memory" },
  { key: "activity", label: "Activity" },
  { key: "settings", label: "Settings" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

async function load(orgId: string, id: string) {
  try {
    return await getAgent(orgId, id);
  } catch (err) {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  }
}

export async function generateMetadata(props: PageProps<"/agents/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const ctx = await requirePageContext();
  const agent = await prisma.agent.findFirst({ where: { id, orgId: ctx.org.id }, select: { name: true } });
  return { title: agent?.name ?? "AI Employee" };
}

export default async function AgentPage(props: PageProps<"/agents/[id]">) {
  const ctx = await requirePageContext("agents:read");
  const { id } = await props.params;
  const sp = await props.searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "overview";
  const agent = await load(ctx.org.id, id);
  const issues = await validateAgent(ctx.org.id, id);
  const canEdit = ctx.can("agents:write");

  return (
    <PageContainer>
      <BreadcrumbLabel segment={agent.id} label={agent.name} />
      <AgentHeader
        agent={{
          id: agent.id,
          name: agent.name,
          jobTitle: agent.jobTitle,
          department: agent.department?.name ?? null,
          color: agent.avatarColor,
          status: agent.status,
          lifecycle: agent.lifecycle,
          publishedVersion: agent.publishedVersion,
          draftVersion: agent.draftVersion,
          provider: agent.providerConfig?.provider ?? "OFFLINE",
          model: agent.providerConfig?.model ?? "offline-demo",
        }}
        errors={issues.filter((i) => i.level === "error").length}
        canEdit={canEdit}
        canPublish={ctx.can("agents:publish")}
      />
      <nav aria-label="Employee sections" className="-mx-4 mb-6 overflow-x-auto border-b px-4 md:mx-0 md:px-0">
        <ul className="flex gap-1">
          {TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={`/agents/${agent.id}${t.key === "overview" ? "" : `?tab=${t.key}`}`}
                aria-current={tab === t.key ? "page" : undefined}
                scroll={false}
                className={cn(
                  "-mb-px block whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-colors",
                  tab === t.key ? "border-brand text-brand-hover" : "border-transparent text-text-secondary hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {tab === "overview" && <OverviewTab agent={agent} issues={issues} orgId={ctx.org.id} />}
      {tab === "chat" && <ChatTab agent={agent} orgId={ctx.org.id} userId={ctx.user.id} conversationId={typeof sp.conversation === "string" ? sp.conversation : undefined} canChat={ctx.can("agents:chat")} />}
      {tab === "tasks" && <TasksTab agentId={agent.id} orgId={ctx.org.id} canWrite={ctx.can("tasks:write")} />}
      {tab === "knowledge" && <KnowledgeTab agent={agent} orgId={ctx.org.id} canEdit={canEdit} />}
      {tab === "tools" && <ToolsTab agent={agent} orgId={ctx.org.id} canEdit={canEdit} />}
      {tab === "workflows" && <WorkflowsTab agent={agent} orgId={ctx.org.id} canEdit={canEdit} />}
      {tab === "memory" && <MemoryTab agentId={agent.id} orgId={ctx.org.id} canEdit={canEdit} />}
      {tab === "activity" && <ActivityTab agentId={agent.id} orgId={ctx.org.id} />}
      {tab === "settings" && <SettingsTab agent={agent} orgId={ctx.org.id} canEdit={canEdit} section={typeof sp.section === "string" ? sp.section : undefined} />}
    </PageContainer>
  );
}
