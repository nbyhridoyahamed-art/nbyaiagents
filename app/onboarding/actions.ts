"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { getSession } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { createOrganization } from "@/server/services/organizations";

const schema = z.object({
  name: z.string().trim().min(2, "Enter your company name.").max(80),
  industry: z.string().trim().max(60).optional(),
  companySize: z.string().trim().max(30).optional(),
  website: z.union([z.literal(""), z.string().trim().url("Enter a full URL, e.g. https://example.com").max(200)]).optional(),
  timezone: z.string().min(1, "Choose a timezone."),
  businessGoals: z.array(z.string().max(60)).max(12).default([]),
});

export async function createCompanyAction(input: z.input<typeof schema>): Promise<ActionResult<{ orgId: string }>> {
  const result = await runAction(schema, input, async (data) => {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Please sign in again.");
    const org = await createOrganization(session.userId, data, session.id);
    return { orgId: org.id };
  });
  if (!result.ok) return result;
  redirect("/onboarding/team");
}
