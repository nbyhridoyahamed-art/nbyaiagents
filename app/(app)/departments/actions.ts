"use server";

import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireOrgContext } from "@/lib/auth/context";
import { userActor } from "@/lib/auth/actor";
import { createDepartment, deleteDepartment, updateDepartment } from "@/server/services/departments";

const schema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Enter a name.").max(60),
  description: z.string().trim().max(300).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(30).optional(),
});

export async function saveDepartmentAction(input: z.input<typeof schema>): Promise<ActionResult> {
  return runAction(schema, input, async ({ id, ...data }) => {
    const ctx = await requireOrgContext("departments:manage");
    const actor = userActor(ctx.org.id, ctx.user.id);
    if (id) await updateDepartment(actor, id, data);
    else await createDepartment(actor, data);
  });
}

export async function deleteDepartmentAction(id: string): Promise<ActionResult> {
  return runAction(z.string().min(1), id, async (deptId) => {
    const ctx = await requireOrgContext("departments:manage");
    await deleteDepartment(userActor(ctx.org.id, ctx.user.id), deptId);
  });
}
