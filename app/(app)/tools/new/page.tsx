import type { Metadata } from "next";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { RestToolBuilder } from "@/components/tools/rest-tool-builder";

export const metadata: Metadata = { title: "New REST API tool" };

export default async function NewToolPage() {
  const ctx = await requirePageContext("tools:manage");
  const creds = ctx.can("credentials:manage")
    ? await prisma.toolCredential.findMany({ where: { orgId: ctx.org.id, revokedAt: null }, select: { id: true, name: true, hint: true } })
    : [];
  return (
    <PageContainer className="max-w-[1300px]">
      <PageHeader eyebrow="Tools" title="Custom REST API tool" description="Turn any HTTP API into a tool your AI employees can use — with a schema, authentication and a risk level." />
      <RestToolBuilder credentials={creds} />
    </PageContainer>
  );
}
