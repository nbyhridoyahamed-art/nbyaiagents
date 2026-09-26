import { prisma } from "@/lib/db";
import type { ApprovalCondition } from "@/lib/approvals/conditions";
import type { PolicyEnforcement } from "@/lib/policies/types";
import type { EngineApprovalRule, EnginePolicy } from "@/lib/permissions/engine";

/** Enabled policies that apply to an agent: company-wide, its department, and itself. */
export async function applicablePolicies(orgId: string, agentId: string, departmentId: string | null): Promise<EnginePolicy[]> {
  const rows = await prisma.policy.findMany({
    where: {
      orgId,
      enabled: true,
      OR: [{ scope: "ORGANIZATION" }, ...(departmentId ? [{ scope: "DEPARTMENT" as const, departmentId }] : []), { scope: "AGENT", agentId }],
    },
    orderBy: { scope: "asc" },
  });
  return rows.map((p) => ({ id: p.id, name: p.name, scope: p.scope, enforcement: (p.enforcement as PolicyEnforcement | null) ?? null }));
}

export async function applicableApprovalRules(orgId: string, agentId: string, departmentId: string | null): Promise<EngineApprovalRule[]> {
  const rows = await prisma.approvalPolicy.findMany({
    where: {
      orgId,
      enabled: true,
      OR: [{ scope: "ORGANIZATION" }, ...(departmentId ? [{ scope: "DEPARTMENT" as const, departmentId }] : []), { scope: "AGENT", agentId }],
    },
    orderBy: { priority: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    effect: r.effect,
    conditions: ((r.conditions as { all?: ApprovalCondition[] })?.all ?? []) as ApprovalCondition[],
  }));
}

/** Email domains considered internal: the org website domain and its members' email domains. */
export async function internalDomains(orgId: string): Promise<string[]> {
  const [org, members] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { website: true } }),
    prisma.organizationMember.findMany({ where: { orgId }, select: { user: { select: { email: true } } } }),
  ]);
  const domains = new Set<string>();
  if (org?.website) {
    try {
      domains.add(new URL(org.website).hostname.replace(/^www\./, "").toLowerCase());
    } catch {
      /* invalid website — ignore */
    }
  }
  const PUBLIC = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me", "protonmail.com"]);
  for (const m of members) {
    const d = m.user.email.split("@")[1]?.toLowerCase();
    // Shared consumer domains never count as "internal".
    if (d && !PUBLIC.has(d)) domains.add(d);
  }
  return [...domains];
}
