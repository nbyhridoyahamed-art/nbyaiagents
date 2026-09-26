"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireOrgContext } from "@/lib/auth/context";
import { userActor } from "@/lib/auth/actor";
import { addMemory, deleteMemory } from "@/server/services/memory";

export async function addMemoryAction(input: { agentId: string; content: string; scope: "LONG_TERM" | "ORGANIZATION" }): Promise<ActionResult> {
  return runAction(
    z.object({ agentId: z.string().min(1), content: z.string().trim().min(3, "Write a memory.").max(2000), scope: z.enum(["LONG_TERM", "ORGANIZATION"]) }),
    input,
    async (data) => {
      const ctx = await requireOrgContext("agents:write");
      await addMemory(userActor(ctx.org.id, ctx.user.id), data);
      revalidatePath(`/agents/${data.agentId}`);
    },
  );
}

export async function deleteMemoryAction(memoryId: string): Promise<ActionResult> {
  return runAction(z.string().min(1), memoryId, async (id) => {
    const ctx = await requireOrgContext("agents:write");
    await deleteMemory(userActor(ctx.org.id, ctx.user.id), id);
  });
}
