import type { Metadata } from "next";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { listProviderStatus } from "@/server/services/ai-providers";
import { ProvidersView } from "./providers-view";

export const metadata: Metadata = { title: "AI providers" };

export default async function ProvidersPage() {
  const ctx = await requirePageContext();
  const [statuses, providers, usage] = await Promise.all([
    listProviderStatus(ctx.org.id),
    prisma.aiProvider.findMany({ where: { orgId: ctx.org.id }, include: { credential: { select: { hint: true, createdAt: true, lastUsedAt: true } } } }),
    prisma.agentProviderConfig.groupBy({ by: ["provider"], where: { agent: { orgId: ctx.org.id, deletedAt: null } }, _count: true }),
  ]);
  return (
    <ProvidersView
      canManage={ctx.can("credentials:manage")}
      providers={statuses
        .filter((s) => s.kind !== "OFFLINE")
        .map((s) => {
          const p = providers.find((x) => x.kind === s.kind);
          return {
            kind: s.kind,
            configured: s.configured,
            source: s.source,
            hint: p?.credential?.hint ?? null,
            baseUrl: p?.baseUrl ?? null,
            defaultModel: p?.defaultModel ?? null,
            agents: usage.find((u) => u.provider === s.kind)?._count ?? 0,
          };
        })}
      offlineAgents={usage.find((u) => u.provider === "OFFLINE")?._count ?? 0}
    />
  );
}
