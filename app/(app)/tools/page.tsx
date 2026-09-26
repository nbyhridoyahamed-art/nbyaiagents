import type { Metadata } from "next";
import Link from "next/link";
import { Plug, Plus, Wrench } from "lucide-react";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { RiskBadge, SimulatedBadge } from "@/components/tools/risk-badge";
import { listCredentials } from "@/server/services/credentials";
import { effectiveToolMeta } from "@/server/tools/executor";
import { CredentialsPanel } from "./credentials-panel";

export const metadata: Metadata = { title: "Tools" };

export default async function ToolsPage() {
  const ctx = await requirePageContext("tools:read");
  const [tools, credentials] = await Promise.all([
    prisma.tool.findMany({
      where: { orgId: ctx.org.id, deletedAt: null },
      include: { _count: { select: { agents: { where: { effect: { not: "DENY" } } } } }, connection: { select: { status: true } } },
      orderBy: [{ kind: "asc" }, { integrationKey: "asc" }, { name: "asc" }],
    }),
    ctx.can("credentials:manage") ? listCredentials(ctx.org.id) : Promise.resolve([]),
  ]);
  const canManage = ctx.can("tools:manage");

  return (
    <PageContainer>
      <PageHeader
        title="Tools"
        description="Every action an AI employee can take. Each tool declares its schema, risk and capabilities, and every call is permission-checked on the server."
        actions={
          canManage && (
            <>
              <Button asChild variant="outline" size="lg">
                <Link href="/integrations">
                  <Plug aria-hidden /> Integrations
                </Link>
              </Button>
              <Button asChild size="lg">
                <Link href="/tools/new">
                  <Plus aria-hidden /> Custom REST API tool
                </Link>
              </Button>
            </>
          )
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {tools.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="No tools yet"
            description="Connect an integration (simulated demo integrations are available) or define your own REST API tool."
            action={
              canManage && (
                <Button asChild>
                  <Link href="/integrations">Connect Tool</Link>
                </Button>
              )
            }
          />
        ) : (
          <ul className="divide-y rounded-xl border bg-surface shadow-card">
            {tools.map((t) => {
              const meta = effectiveToolMeta(t);
              return (
                <li key={t.id}>
                  <Link href={`/tools/${t.id}`} className="flex flex-col gap-2 p-4 hover:bg-surface-2 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium">
                        {t.name}
                        {t.isSimulated && <SimulatedBadge />}
                        {!t.enabled && <span className="rounded bg-surface-2 px-1.5 text-[11px] text-text-muted">Disabled</span>}
                      </p>
                      <p className="truncate text-xs text-text-muted">
                        <span className="font-mono">{t.key}</span> · {t.kind === "CUSTOM_HTTP" ? "Custom REST API" : t.integrationKey} · v{t.version}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-text-muted">
                        {t._count.agents} employee{t._count.agents === 1 ? "" : "s"}
                      </span>
                      <RiskBadge risk={meta.riskLevel} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {ctx.can("credentials:manage") && (
          <CredentialsPanel
            credentials={credentials.map((c) => ({
              id: c.id,
              name: c.name,
              type: c.type,
              hint: c.hint,
              revoked: !!c.revokedAt,
              rotatedAt: c.rotatedAt?.toISOString() ?? null,
              lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
              usage: c._count.tools + c._count.connections + c._count.providers,
            }))}
          />
        )}
      </div>
    </PageContainer>
  );
}
