import { timeZoneOptions } from "@/lib/timezones";
import type { Metadata } from "next";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { CompanyForm } from "./company-form";

export const metadata: Metadata = { title: "Company settings" };

export default async function CompanySettingsPage() {
  const ctx = await requirePageContext();
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.org.id } });
  return (
    <CompanyForm
      canEdit={ctx.can("org:manage")}
      timezones={timeZoneOptions()}
      initial={{
        name: org.name,
        industry: org.industry ?? "",
        companySize: org.companySize ?? "",
        website: org.website ?? "",
        description: org.description ?? "",
        timezone: org.timezone,
        monthlyAiBudgetUsd: org.monthlyAiBudgetUsd,
      }}
      slug={org.slug}
      plan={org.plan}
    />
  );
}
