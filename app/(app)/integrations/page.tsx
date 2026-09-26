import type { Metadata } from "next";
import { requirePageContext } from "@/lib/auth/context";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { listIntegrations } from "@/server/services/integrations";
import { IntegrationsGrid } from "./integrations-grid";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const ctx = await requirePageContext("tools:read");
  const integrations = await listIntegrations(ctx.org.id);
  return (
    <PageContainer>
      <PageHeader
        title="Integrations"
        description="Connect the systems your AI employees work in. Every connection's status is shown exactly as it is — simulated integrations never contact the outside world."
      />
      <IntegrationsGrid integrations={integrations} canManage={ctx.can("tools:manage")} />
    </PageContainer>
  );
}
