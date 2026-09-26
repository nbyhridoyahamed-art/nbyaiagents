import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { Prisma } from "@/lib/generated/prisma/client";
import type { PolicyScope } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/lib/auth/actor";
import { policyEnforcementSchema, type PolicyEnforcement } from "@/lib/policies/types";
import { writeAudit } from "@/server/services/audit";
import { approvalConditionsSchema, type ApprovalCondition } from "@/lib/approvals/conditions";

export interface PolicyInput {
  name: string;
  rule: string;
  scope: PolicyScope;
  departmentId?: string | null;
  agentId?: string | null;
  enforcement?: PolicyEnforcement | null;
  enabled?: boolean;
}

async function validateScope(orgId: string, input: PolicyInput) {
  if (input.scope === "DEPARTMENT") {
    if (!input.departmentId) throw new AppError("VALIDATION", "Choose a department for a department policy.");
    const d = await prisma.department.findFirst({ where: { id: input.departmentId, orgId, deletedAt: null } });
    if (!d) throw notFound("Department");
  }
  if (input.scope === "AGENT") {
    if (!input.agentId) throw new AppError("VALIDATION", "Choose an employee for an employee policy.");
    const a = await prisma.agent.findFirst({ where: { id: input.agentId, orgId, deletedAt: null } });
    if (!a) throw notFound("AI employee");
  }
  if (input.enforcement) policyEnforcementSchema.parse(input.enforcement);
}

export async function listPolicies(orgId: string) {
  return prisma.policy.findMany({
    where: { orgId },
    include: { department: { select: { name: true } }, agent: { select: { name: true } } },
    orderBy: [{ scope: "asc" }, { createdAt: "asc" }],
  });
}

export async function createPolicy(actor: Actor, input: PolicyInput) {
  await validateScope(actor.orgId, input);
  const policy = await prisma.policy.create({
    data: {
      orgId: actor.orgId,
      name: input.name.trim(),
      rule: input.rule.trim(),
      scope: input.scope,
      departmentId: input.scope === "DEPARTMENT" ? input.departmentId : null,
      agentId: input.scope === "AGENT" ? input.agentId : null,
      enforcement: (input.enforcement ?? undefined) as Prisma.InputJsonValue | undefined,
      enabled: input.enabled ?? true,
    },
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "policy.create", entityType: "Policy", entityId: policy.id, metadata: { ...input } });
  return policy;
}

export async function updatePolicy(actor: Actor, id: string, input: PolicyInput) {
  const existing = await prisma.policy.findFirst({ where: { id, orgId: actor.orgId } });
  if (!existing) throw notFound("Policy");
  await validateScope(actor.orgId, input);
  const policy = await prisma.policy.update({
    where: { id },
    data: {
      name: input.name.trim(),
      rule: input.rule.trim(),
      scope: input.scope,
      departmentId: input.scope === "DEPARTMENT" ? input.departmentId : null,
      agentId: input.scope === "AGENT" ? input.agentId : null,
      enforcement: input.enforcement === null ? Prisma.DbNull : (input.enforcement as Prisma.InputJsonValue | undefined),
      enabled: input.enabled ?? existing.enabled,
    },
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "policy.update", entityType: "Policy", entityId: id, metadata: { ...input } });
  return policy;
}

export async function togglePolicy(actor: Actor, id: string, enabled: boolean) {
  const existing = await prisma.policy.findFirst({ where: { id, orgId: actor.orgId } });
  if (!existing) throw notFound("Policy");
  await prisma.policy.update({ where: { id }, data: { enabled } });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: enabled ? "policy.enable" : "policy.disable", entityType: "Policy", entityId: id });
}

export async function deletePolicy(actor: Actor, id: string) {
  const existing = await prisma.policy.findFirst({ where: { id, orgId: actor.orgId } });
  if (!existing) throw notFound("Policy");
  await prisma.policy.delete({ where: { id } });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "policy.delete", entityType: "Policy", entityId: id, metadata: { name: existing.name } });
}

// ── Approval policies (IF conditions THEN require approval / deny) ───────────

export interface ApprovalPolicyInput {
  name: string;
  description?: string;
  scope: PolicyScope;
  departmentId?: string | null;
  agentId?: string | null;
  conditions: ApprovalCondition[];
  effect: "REQUIRE_APPROVAL" | "DENY";
  priority?: number;
  enabled?: boolean;
}

function approvalData(input: ApprovalPolicyInput) {
  approvalConditionsSchema.parse({ all: input.conditions });
  return {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    scope: input.scope,
    departmentId: input.scope === "DEPARTMENT" ? input.departmentId : null,
    agentId: input.scope === "AGENT" ? input.agentId : null,
    conditions: { all: input.conditions } as unknown as Prisma.InputJsonValue,
    effect: input.effect,
    priority: input.priority ?? 100,
    enabled: input.enabled ?? true,
  };
}

export async function saveApprovalPolicy(actor: Actor, id: string | undefined, input: ApprovalPolicyInput) {
  await validateScope(actor.orgId, { name: input.name, rule: input.name, scope: input.scope, departmentId: input.departmentId, agentId: input.agentId });
  if (id) {
    const existing = await prisma.approvalPolicy.findFirst({ where: { id, orgId: actor.orgId } });
    if (!existing) throw notFound("Approval rule");
    await prisma.approvalPolicy.update({ where: { id }, data: approvalData(input) });
  } else {
    const created = await prisma.approvalPolicy.create({ data: { orgId: actor.orgId, ...approvalData(input) } });
    id = created.id;
  }
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "approval_policy.save", entityType: "ApprovalPolicy", entityId: id, metadata: { ...input } });
  return id;
}

export async function toggleApprovalPolicy(actor: Actor, id: string, enabled: boolean) {
  const existing = await prisma.approvalPolicy.findFirst({ where: { id, orgId: actor.orgId } });
  if (!existing) throw notFound("Approval rule");
  await prisma.approvalPolicy.update({ where: { id }, data: { enabled } });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: enabled ? "approval_policy.enable" : "approval_policy.disable", entityType: "ApprovalPolicy", entityId: id });
}

export async function deleteApprovalPolicy(actor: Actor, id: string) {
  const existing = await prisma.approvalPolicy.findFirst({ where: { id, orgId: actor.orgId } });
  if (!existing) throw notFound("Approval rule");
  await prisma.approvalPolicy.delete({ where: { id } });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "approval_policy.delete", entityType: "ApprovalPolicy", entityId: id, metadata: { name: existing.name } });
}
