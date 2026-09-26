"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requirePlatformAdmin } from "@/lib/auth/admin";
import { setCatalogItemEnabled, setOrganizationPlan, setOrganizationSuspended, setUserDisabled, setUserPlatformRole } from "@/server/services/admin";

const id = z.string().min(1).max(40);

export async function setPlanAction(input: { orgId: string; plan: string }): Promise<ActionResult> {
  return runAction(z.object({ orgId: id, plan: z.enum(["FREE", "STARTER", "GROWTH", "ENTERPRISE"]) }), input, async ({ orgId, plan }) => {
    const admin = await requirePlatformAdmin();
    await setOrganizationPlan(admin.userId, orgId, plan);
    revalidatePath("/admin", "layout");
  });
}

export async function suspendOrgAction(input: { orgId: string; suspended: boolean; reason?: string }): Promise<ActionResult> {
  return runAction(z.object({ orgId: id, suspended: z.boolean(), reason: z.string().trim().max(500).optional() }), input, async ({ orgId, suspended, reason }) => {
    const admin = await requirePlatformAdmin();
    await setOrganizationSuspended(admin.userId, orgId, suspended, reason);
    revalidatePath("/admin", "layout");
  });
}

export async function setUserDisabledAction(input: { userId: string; disabled: boolean }): Promise<ActionResult> {
  return runAction(z.object({ userId: id, disabled: z.boolean() }), input, async ({ userId, disabled }) => {
    const admin = await requirePlatformAdmin();
    await setUserDisabled(admin.userId, userId, disabled);
    revalidatePath("/admin/users");
  });
}

export async function setUserRoleAction(input: { userId: string; role: "USER" | "SUPER_ADMIN" }): Promise<ActionResult> {
  return runAction(z.object({ userId: id, role: z.enum(["USER", "SUPER_ADMIN"]) }), input, async ({ userId, role }) => {
    const admin = await requirePlatformAdmin();
    await setUserPlatformRole(admin.userId, userId, role);
    revalidatePath("/admin/users");
  });
}

export async function setCatalogEnabledAction(input: { kind: "integrations" | "templates"; key: string; enabled: boolean }): Promise<ActionResult> {
  return runAction(z.object({ kind: z.enum(["integrations", "templates"]), key: z.string().min(1).max(60), enabled: z.boolean() }), input, async ({ kind, key, enabled }) => {
    const admin = await requirePlatformAdmin();
    await setCatalogItemEnabled(admin.userId, kind, key, enabled);
    revalidatePath("/admin/catalog");
  });
}
