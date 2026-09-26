"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireOrgContext } from "@/lib/auth/context";
import { userActor } from "@/lib/auth/actor";
import { installWorkflowTemplate, templateReadiness } from "@/server/services/templates";

const installSchema = z.object({
  templateKey: z.string().min(1).max(60),
  name: z.string().trim().max(120).optional(),
  roles: z.record(z.string().max(40), z.string().min(1).max(40)),
});

export async function installWorkflowTemplateAction(input: z.input<typeof installSchema>): Promise<ActionResult<{ workflowId: string; notes: string[] }>> {
  return runAction(installSchema, input, async ({ templateKey, name, roles }) => {
    const ctx = await requireOrgContext("templates:install");
    if (!ctx.can("workflows:write")) {
      const { AppError } = await import("@/lib/errors");
      throw new AppError("FORBIDDEN", "You need permission to create workflows.");
    }
    const res = await installWorkflowTemplate(userActor(ctx.org.id, ctx.user.id), templateKey, { name, roles });
    revalidatePath("/templates");
    revalidatePath("/workflows");
    return { workflowId: res.workflowId, notes: res.notes };
  });
}

const checkSchema = z.object({ templateKey: z.string().min(1).max(60), roles: z.record(z.string().max(40), z.string().min(1).max(40)) });

/** Live readiness notes while the user picks employees. */
export async function checkTemplateAction(input: z.input<typeof checkSchema>): Promise<ActionResult<{ notes: string[] }>> {
  return runAction(checkSchema, input, async ({ templateKey, roles }) => {
    const ctx = await requireOrgContext("templates:install");
    return { notes: await templateReadiness(ctx.org.id, templateKey, roles) };
  });
}
