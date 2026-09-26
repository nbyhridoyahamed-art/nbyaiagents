import type { Metadata } from "next";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { listPolicies } from "@/server/services/policies";
import type { PolicyEnforcement } from "@/lib/policies/types";
import { PoliciesView } from "./policies-view";
import { ApprovalPoliciesView } from "./approval-policies-view";
import type { ApprovalCondition } from "@/lib/approvals/conditions";

export const metadata: Metadata = { title: "AI policies" };

export default async function PoliciesPage() {
  const ctx = await requirePageContext();
  const [policies, approvalPolicies, departments, agents] = await Promise.all([
    listPolicies(ctx.org.id),
    prisma.approvalPolicy.findMany({
      where: { orgId: ctx.org.id },
      orderBy: { priority: "asc" },
      include: { department: { select: { name: true } }, agent: { select: { name: true } } },
    }),
    prisma.department.findMany({ where: { orgId: ctx.org.id, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.agent.findMany({ where: { orgId: ctx.org.id, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="grid gap-8">
      <PoliciesView
        canManage={ctx.can("policies:manage")}
        departments={departments}
        agents={agents}
        policies={policies.map((p) => ({
          id: p.id,
          name: p.name,
          rule: p.rule,
          scope: p.scope,
          departmentId: p.departmentId,
          agentId: p.agentId,
          scopeLabel: p.scope === "ORGANIZATION" ? "Company-wide" : p.scope === "DEPARTMENT" ? (p.department?.name ?? "Department") : (p.agent?.name ?? "Employee"),
          enforcement: (p.enforcement as PolicyEnforcement | null) ?? null,
          enabled: p.enabled,
        }))}
      />
      <div id="approval-rules" className="scroll-mt-24">
      <ApprovalPoliciesView
        canManage={ctx.can("policies:manage")}
        departments={departments}
        agents={agents}
        policies={approvalPolicies.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          scope: p.scope,
          departmentId: p.departmentId,
          agentId: p.agentId,
          scopeLabel: p.scope === "ORGANIZATION" ? "Company-wide" : p.scope === "DEPARTMENT" ? (p.department?.name ?? "Department") : (p.agent?.name ?? "Employee"),
          conditions: ((p.conditions as { all?: ApprovalCondition[] })?.all ?? []) as ApprovalCondition[],
          effect: p.effect,
          priority: p.priority,
          enabled: p.enabled,
        }))}
      />
      </div>
    </div>
  );
}
