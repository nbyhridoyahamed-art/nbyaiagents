"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireOrgContext } from "@/lib/auth/context";
import { userActor } from "@/lib/auth/actor";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createWebsite, deleteWebsite, linkAnalytics, linkSearchConsole, startSiteAudit, unlinkProperty } from "@/server/services/websites";

const id = z.string().min(1).max(40);

const addSchema = z.object({ domain: z.string().trim().min(1, "Enter your website's address.").max(300), name: z.string().trim().max(80).optional() });

export async function addWebsiteAction(input: z.input<typeof addSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(addSchema, input, async (d) => {
    const ctx = await requireOrgContext("tools:manage");
    const site = await createWebsite(userActor(ctx.org.id, ctx.user.id), d);
    revalidatePath("/websites");
    return { id: site.id };
  });
}

export async function deleteWebsiteAction(websiteId: string): Promise<ActionResult> {
  return runAction(id, websiteId, async (siteId) => {
    const ctx = await requireOrgContext("tools:manage");
    await deleteWebsite(userActor(ctx.org.id, ctx.user.id), siteId);
    revalidatePath("/websites");
  });
}

export async function linkSearchConsoleAction(input: { id: string; siteUrl: string }): Promise<ActionResult> {
  return runAction(z.object({ id, siteUrl: z.string().min(4).max(300) }), input, async (d) => {
    const ctx = await requireOrgContext("tools:manage");
    await enforceRateLimit("toolTest", `${ctx.org.id}:${ctx.user.id}`);
    await linkSearchConsole(userActor(ctx.org.id, ctx.user.id), d.id, d.siteUrl);
    revalidatePath("/websites", "layout");
  });
}

export async function linkAnalyticsAction(input: { id: string; property: string }): Promise<ActionResult> {
  return runAction(z.object({ id, property: z.string().min(3).max(60) }), input, async (d) => {
    const ctx = await requireOrgContext("tools:manage");
    await enforceRateLimit("toolTest", `${ctx.org.id}:${ctx.user.id}`);
    await linkAnalytics(userActor(ctx.org.id, ctx.user.id), d.id, d.property);
    revalidatePath("/websites", "layout");
  });
}

export async function unlinkPropertyAction(input: { id: string; kind: "search_console" | "analytics" }): Promise<ActionResult> {
  return runAction(z.object({ id, kind: z.enum(["search_console", "analytics"]) }), input, async (d) => {
    const ctx = await requireOrgContext("tools:manage");
    await unlinkProperty(userActor(ctx.org.id, ctx.user.id), d.id, d.kind);
    revalidatePath("/websites", "layout");
  });
}

export async function runSiteAuditAction(input: { id: string; agentId: string }): Promise<ActionResult<{ taskId: string }>> {
  return runAction(z.object({ id, agentId: id }), input, async (d) => {
    const ctx = await requireOrgContext("tasks:write");
    await enforceRateLimit("agentRun", `${ctx.org.id}:${ctx.user.id}`);
    const task = await startSiteAudit(userActor(ctx.org.id, ctx.user.id), d.id, d.agentId);
    revalidatePath("/tasks");
    return { taskId: task.id };
  });
}
