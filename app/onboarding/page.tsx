import { timeZoneOptions } from "@/lib/timezones";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getOrgContext, getSession } from "@/lib/auth/context";
import { CompanySetup } from "./company-setup";

export const metadata: Metadata = { title: "Set up your company" };

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const ctx = await getOrgContext();
  if (ctx) redirect(ctx.org.onboardingCompletedAt ? "/dashboard" : "/onboarding/team");
  const timezones = timeZoneOptions();
  return <CompanySetup userName={session.user.name.split(" ")[0] ?? ""} timezones={timezones} />;
}
