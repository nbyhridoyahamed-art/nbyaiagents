import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { recommendTemplates } from "@/lib/onboarding";
import { getAgentTemplate } from "@/lib/templates/agents";
import { TeamStep } from "./team-step";

export const metadata: Metadata = { title: "Recommended AI employees" };

export default async function OnboardingTeamPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/onboarding");
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.org.id } });
  const recommended = recommendTemplates(org.businessGoals)
    .map((key) => getAgentTemplate(key))
    .filter((t) => t !== undefined)
    .map((t) => ({ key: t.key, name: t.suggestedName, jobTitle: t.jobTitle, department: t.department, summary: t.summary, color: t.color }));
  return <TeamStep companyName={org.name} recommended={recommended} />;
}
