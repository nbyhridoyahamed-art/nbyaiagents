"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireOrgContext } from "@/lib/auth/context";
import { userActor } from "@/lib/auth/actor";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { policyEnforcementSchema } from "@/lib/policies/types";
import { hashPassword, passwordProblems, verifyPassword } from "@/lib/security/password";
import { updateOrganization } from "@/server/services/organizations";
import { changeMemberRole, inviteMember, removeMember, revokeInvitation } from "@/server/services/members";
import {
  createPolicy,
  deleteApprovalPolicy,
  deletePolicy,
  saveApprovalPolicy,
  toggleApprovalPolicy,
  togglePolicy,
  updatePolicy,
} from "@/server/services/policies";
import { approvalConditionSchema } from "@/lib/approvals/conditions";
import { writeAudit } from "@/server/services/audit";

const orgRole = z.enum(["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"]);

// ── Company ──────────────────────────────────────────────────────────────────

const companySchema = z.object({
  name: z.string().trim().min(2, "Enter your company name.").max(80),
  industry: z.string().trim().max(60).optional(),
  companySize: z.string().trim().max(30).optional(),
  website: z.union([z.literal(""), z.string().trim().url("Enter a full URL, e.g. https://example.com").max(200)]).optional(),
  description: z.string().trim().max(2000).optional(),
  timezone: z.string().min(1),
  monthlyAiBudgetUsd: z.coerce.number().min(0, "Budget can't be negative.").max(1_000_000),
});

export async function updateCompanyAction(input: z.input<typeof companySchema>): Promise<ActionResult> {
  return runAction(companySchema, input, async (data) => {
    const ctx = await requireOrgContext("org:manage");
    await updateOrganization(ctx.org.id, ctx.user.id, data);
    revalidatePath("/", "layout");
  });
}

// ── Members ──────────────────────────────────────────────────────────────────

export async function inviteMemberAction(input: { email: string; role: string }): Promise<ActionResult<{ link: string }>> {
  return runAction(z.object({ email: z.string().trim().email("Enter a valid email."), role: orgRole }), input, async (data) => {
    const ctx = await requireOrgContext("members:manage");
    const { link } = await inviteMember({ ...userActor(ctx.org.id, ctx.user.id), userId: ctx.user.id }, data.email, data.role);
    return { link };
  });
}

export async function revokeInvitationAction(invitationId: string): Promise<ActionResult> {
  return runAction(z.string().min(1), invitationId, async (id) => {
    const ctx = await requireOrgContext("members:manage");
    await revokeInvitation({ ...userActor(ctx.org.id, ctx.user.id), userId: ctx.user.id }, id);
  });
}

export async function changeRoleAction(input: { memberId: string; role: string }): Promise<ActionResult> {
  return runAction(z.object({ memberId: z.string().min(1), role: orgRole }), input, async (data) => {
    const ctx = await requireOrgContext("members:manage");
    await changeMemberRole({ ...userActor(ctx.org.id, ctx.user.id), userId: ctx.user.id }, data.memberId, data.role);
  });
}

export async function removeMemberAction(memberId: string): Promise<ActionResult> {
  return runAction(z.string().min(1), memberId, async (id) => {
    const ctx = await requireOrgContext();
    const member = await prisma.organizationMember.findFirst({ where: { id, orgId: ctx.org.id } });
    // Anyone may leave; removing others requires members:manage.
    if (member?.userId !== ctx.user.id && !ctx.can("members:manage")) throw new AppError("FORBIDDEN", "You can't remove members.");
    await removeMember({ ...userActor(ctx.org.id, ctx.user.id), userId: ctx.user.id }, id);
  });
}

// ── Profile ──────────────────────────────────────────────────────────────────

export async function updateProfileAction(input: { name: string }): Promise<ActionResult> {
  return runAction(z.object({ name: z.string().trim().min(1, "Enter your name.").max(100) }), input, async (data) => {
    const ctx = await requireOrgContext();
    await prisma.user.update({ where: { id: ctx.user.id }, data: { name: data.name } });
    revalidatePath("/", "layout");
  });
}

const passwordSchema = z
  .object({ current: z.string().min(1, "Enter your current password."), next: z.string().min(1, "Choose a new password."), confirm: z.string() })
  .refine((d) => d.next === d.confirm, { message: "Passwords don't match.", path: ["confirm"] });

export async function changePasswordAction(input: z.input<typeof passwordSchema>): Promise<ActionResult> {
  return runAction(passwordSchema, input, async (data) => {
    const ctx = await requireOrgContext();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (!user.passwordHash || !(await verifyPassword(data.current, user.passwordHash))) {
      throw new AppError("VALIDATION", "Current password is incorrect.", { fieldErrors: { current: "Incorrect password." } });
    }
    const problem = passwordProblems(data.next);
    if (problem) throw new AppError("VALIDATION", problem, { fieldErrors: { next: problem } });
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(data.next) } }),
      // Sign out other devices; keep the current session.
      prisma.session.deleteMany({ where: { userId: user.id, id: { not: ctx.sessionId } } }),
    ]);
    await writeAudit({ orgId: ctx.org.id, actorType: "USER", actorUserId: user.id, action: "auth.password_change" });
  });
}

// ── Policies ─────────────────────────────────────────────────────────────────

const policySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Give the policy a name.").max(80),
  rule: z.string().trim().min(5, "Describe the rule.").max(1000),
  scope: z.enum(["ORGANIZATION", "DEPARTMENT", "AGENT"]),
  departmentId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  enforcement: policyEnforcementSchema.nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function savePolicyAction(input: z.input<typeof policySchema>): Promise<ActionResult> {
  return runAction(policySchema, input, async ({ id, ...data }) => {
    const ctx = await requireOrgContext("policies:manage");
    const actor = userActor(ctx.org.id, ctx.user.id);
    if (id) await updatePolicy(actor, id, data);
    else await createPolicy(actor, data);
  });
}

export async function togglePolicyAction(input: { id: string; enabled: boolean }): Promise<ActionResult> {
  return runAction(z.object({ id: z.string().min(1), enabled: z.boolean() }), input, async (data) => {
    const ctx = await requireOrgContext("policies:manage");
    await togglePolicy(userActor(ctx.org.id, ctx.user.id), data.id, data.enabled);
  });
}

export async function deletePolicyAction(id: string): Promise<ActionResult> {
  return runAction(z.string().min(1), id, async (policyId) => {
    const ctx = await requireOrgContext("policies:manage");
    await deletePolicy(userActor(ctx.org.id, ctx.user.id), policyId);
  });
}

// ── Approval policies ────────────────────────────────────────────────────────

const approvalPolicySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Give the rule a name.").max(80),
  description: z.string().trim().max(300).optional(),
  scope: z.enum(["ORGANIZATION", "DEPARTMENT", "AGENT"]),
  departmentId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  conditions: z.array(approvalConditionSchema).min(1, "Add at least one condition.").max(10),
  effect: z.enum(["REQUIRE_APPROVAL", "DENY"]),
  priority: z.number().int().min(0).max(1000).optional(),
  enabled: z.boolean().optional(),
});

export async function saveApprovalPolicyAction(input: z.input<typeof approvalPolicySchema>): Promise<ActionResult> {
  return runAction(approvalPolicySchema, input, async ({ id, ...data }) => {
    const ctx = await requireOrgContext("policies:manage");
    await saveApprovalPolicy(userActor(ctx.org.id, ctx.user.id), id, data);
  });
}

export async function toggleApprovalPolicyAction(input: { id: string; enabled: boolean }): Promise<ActionResult> {
  return runAction(z.object({ id: z.string().min(1), enabled: z.boolean() }), input, async (data) => {
    const ctx = await requireOrgContext("policies:manage");
    await toggleApprovalPolicy(userActor(ctx.org.id, ctx.user.id), data.id, data.enabled);
  });
}

export async function deleteApprovalPolicyAction(id: string): Promise<ActionResult> {
  return runAction(z.string().min(1), id, async (policyId) => {
    const ctx = await requireOrgContext("policies:manage");
    await deleteApprovalPolicy(userActor(ctx.org.id, ctx.user.id), policyId);
  });
}
