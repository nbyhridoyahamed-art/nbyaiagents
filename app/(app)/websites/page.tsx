import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Globe, Plug, ShieldCheck } from "lucide-react";
import { requirePageContext } from "@/lib/auth/context";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listWebsites } from "@/server/services/websites";
import { googleStatus } from "@/server/services/website-access";
import { AddWebsiteForm } from "./add-website-form";
import { Card } from "./parts";

export const metadata: Metadata = { title: "Websites" };

function LinkState({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="text-text-secondary">{label}</span>
      {value ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <Badge className="bg-success-soft text-success-text">Linked</Badge>
          <span className="max-w-[12rem] truncate text-xs text-text-muted" title={value}>
            {value}
          </span>
        </span>
      ) : (
        <Badge variant="secondary">Not linked</Badge>
      )}
    </div>
  );
}

export default async function WebsitesPage() {
  const ctx = await requirePageContext("analytics:read");
  const [sites, google] = await Promise.all([listWebsites(ctx.org.id), googleStatus(ctx.org.id)]);
  const canManage = ctx.can("tools:manage");
  const googleReady = google.search_console || google.analytics;

  return (
    <PageContainer className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader
        title="Websites"
        description="Add each site you work on and link its Search Console and Analytics once. Your AI employees then see only that site's data, not everything the Google account can open."
      />

      {!googleReady && (
        <div className="flex flex-col gap-3 rounded-[14px] border bg-surface p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Plug className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden />
            <p className="text-[13px] text-text-secondary">Connect Google first so Search Console and Analytics can be linked to your websites.</p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/integrations">Connect Google</Link>
          </Button>
        </div>
      )}

      {sites.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="Add your first website"
          description={canManage ? "Enter its address below. You'll choose its Search Console and Analytics properties on the next screen." : "A workspace manager can add websites here."}
        />
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sites.map((s) => (
              <li key={s.id} className="flex flex-col rounded-xl border bg-surface p-4 shadow-card">
                <Link href={`/websites/${s.id}`} className="group flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-text-secondary">
                    <Globe className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-card-title group-hover:underline">{s.name ?? s.domain}</span>
                    {s.name && <span className="block truncate text-[13px] text-text-secondary">{s.domain}</span>}
                  </span>
                  <ArrowRight className="mt-1 size-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
                <div className="mt-4 grid gap-1.5 border-t pt-3">
                  <LinkState label="Search Console" value={s.gscSiteUrl} />
                  <LinkState label="Analytics" value={s.gaPropertyName ?? s.gaProperty} />
                </div>
              </li>
            ))}
          </ul>
          <p className="flex items-center gap-2 text-xs text-text-muted">
            <ShieldCheck className="size-3.5" aria-hidden /> AI employees&apos; Search Console and Analytics tools are limited to the properties linked above.
          </p>
        </>
      )}

      {canManage && (
        <Card title={sites.length ? "Add another website" : "Add a website"}>
          <AddWebsiteForm />
        </Card>
      )}
    </PageContainer>
  );
}
