import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Sparkles, Users } from "lucide-react";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { AgentCard } from "@/components/agents/agent-card";
import { listAgentCards } from "@/server/services/agent-queries";
import type { AgentStatus } from "@/lib/generated/prisma/enums";
import { STATUS_META } from "@/components/agents/status-meta";
import { AgentFilters } from "./agent-filters";

export const metadata: Metadata = { title: "AI Employees" };

export default async function AgentsPage(props: PageProps<"/agents">) {
  const ctx = await requirePageContext();
  const sp = await props.searchParams;
  const departmentId = typeof sp.department === "string" ? sp.department : undefined;
  const status = typeof sp.status === "string" && sp.status in STATUS_META ? (sp.status as AgentStatus) : undefined;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : undefined;

  const [agents, departments, total] = await Promise.all([
    listAgentCards(ctx.org.id, { departmentId, status, q }),
    prisma.department.findMany({ where: { orgId: ctx.org.id, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.agent.count({ where: { orgId: ctx.org.id, deletedAt: null } }),
  ]);
  const canHire = ctx.can("agents:write");

  return (
    <PageContainer>
      <PageHeader
        title="AI Employees"
        description="Your digital workforce. Each employee has a role, knowledge, tools and permissions you control."
        actions={
          canHire && (
            <>
              <Button asChild variant="outline" size="lg">
                <Link href="/agents/new?mode=ai">
                  <Sparkles aria-hidden className="text-ai" /> Create with AI
                </Link>
              </Button>
              <Button asChild size="lg">
                <Link href="/agents/new">
                  <Plus aria-hidden /> Hire AI Employee
                </Link>
              </Button>
            </>
          )
        }
      />
      {total === 0 ? (
        <EmptyState
          icon={Users}
          title="No AI employees yet."
          description="Build your first digital employee and start assigning real work."
          action={
            canHire && (
              <Button asChild size="lg">
                <Link href="/agents/new">
                  <Plus aria-hidden /> Hire AI Employee
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <AgentFilters departments={departments} />
          {agents.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-surface p-10 text-center text-[13px] text-text-muted">No employees match these filters.</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {agents.map((a) => (
                <li key={a.id}>
                  <AgentCard agent={a} className="h-full" />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </PageContainer>
  );
}
