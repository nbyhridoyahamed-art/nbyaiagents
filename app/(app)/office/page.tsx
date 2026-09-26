import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical, Plus, Users } from "lucide-react";
import { requirePageContext } from "@/lib/auth/context";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { ViewSwitch } from "@/components/office/view-switch";
import { RunLiveRefresher } from "@/app/(app)/runs/[id]/run-live-refresher";
import { getOfficeData } from "@/server/services/office";
import { OfficeLoader } from "./office-loader";
import { OfficeList } from "./office-list";

export const metadata: Metadata = { title: "AI Office" };

export default async function OfficePage() {
  const ctx = await requirePageContext("agents:read");
  const data = await getOfficeData(ctx.org.id);
  const live = data.agents.some((a) => a.activeRuns > 0) || data.workflows.some((w) => w.activeRuns > 0);

  return (
    <PageContainer>
      {live && <RunLiveRefresher intervalMs={15000} />}
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            Your AI company
            {ctx.org.isDemo && (
              <span className="inline-flex items-center gap-1 rounded-md bg-ai-soft px-1.5 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-ai">
                <FlaskConical className="size-3" aria-hidden /> Demo data
              </span>
            )}
          </span>
        }
        title="AI Office"
        description="A map of your AI workforce: who works where, what they're doing, who hands work to whom and which workflows connect them."
        actions={<ViewSwitch current="office" />}
      />
      {data.agents.length === 0 ? (
        <EmptyState
          icon={Users}
          title="The office is empty."
          description="Hire your first AI employee and they'll appear here with their department, work and connections."
          action={
            ctx.can("agents:write") && (
              <Button asChild>
                <Link href="/agents/new">
                  <Plus aria-hidden /> Hire AI Employee
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <OfficeLoader data={data} />
          <OfficeList data={data} />
        </>
      )}
    </PageContainer>
  );
}
