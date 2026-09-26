import { timeZoneOptions } from "@/lib/timezones";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth/context";
import { CompanySetup } from "../company-setup";

export const metadata: Metadata = { title: "New workspace" };

/** Create an additional company workspace (the user becomes its owner). */
export default async function NewCompanyPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <CompanySetup userName={session.user.name.split(" ")[0] ?? ""} timezones={timeZoneOptions()} />;
}
