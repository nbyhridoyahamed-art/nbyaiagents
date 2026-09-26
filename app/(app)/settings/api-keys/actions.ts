"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireOrgContext } from "@/lib/auth/context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { API_SCOPE_KEYS, createApiKey, revokeApiKey } from "@/server/services/api-keys";

const createSchema = z.object({
  name: z.string().trim().min(2, "Name the key.").max(80),
  scopes: z.array(z.enum(API_SCOPE_KEYS)).min(1, "Choose at least one permission."),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).nullable(),
});

/** Returns the full key exactly once. */
export async function createApiKeyAction(input: z.input<typeof createSchema>): Promise<ActionResult<{ key: string; prefix: string }>> {
  return runAction(createSchema, input, async (data) => {
    const ctx = await requireOrgContext("apikeys:manage");
    await enforceRateLimit("toolTest", `${ctx.org.id}:apikey`);
    const res = await createApiKey({ orgId: ctx.org.id, userId: ctx.user.id, type: "USER" }, data);
    revalidatePath("/settings/api-keys");
    return { key: res.key, prefix: res.prefix };
  });
}

export async function revokeApiKeyAction(id: string): Promise<ActionResult> {
  return runAction(z.string().min(1).max(40), id, async (keyId) => {
    const ctx = await requireOrgContext("apikeys:manage");
    await revokeApiKey({ orgId: ctx.org.id, userId: ctx.user.id, type: "USER" }, keyId);
    revalidatePath("/settings/api-keys");
  });
}
