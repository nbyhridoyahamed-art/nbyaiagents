"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireOrgContext } from "@/lib/auth/context";
import { userActor } from "@/lib/auth/actor";
import { prisma } from "@/lib/db";
import { AGENT_TEMPLATES } from "@/lib/templates/agents";
import { createAgentFromTemplate } from "@/server/services/agents";

const schema = z.object({
  templateKeys: z.array(z.enum(AGENT_TEMPLATES.map((t) => t.key) as [string, ...string[]])).max(10),
});

export async function finishOnboardingAction(input: z.input<typeof schema>): Promise<ActionResult> {
  const result = await runAction(schema, input, async ({ templateKeys }) => {
    const ctx = await requireOrgContext();
    const actor = userActor(ctx.org.id, ctx.user.id);
    if (templateKeys.length && ctx.can("agents:write")) {
      for (const key of templateKeys) await createAgentFromTemplate(actor, key);
    }
    await prisma.organization.update({ where: { id: ctx.org.id }, data: { onboardingCompletedAt: new Date() } });
  });
  if (!result.ok) return result;
  redirect("/dashboard?welcome=1");
}
