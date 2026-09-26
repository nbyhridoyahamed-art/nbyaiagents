import { prisma } from "@/lib/db";
import type { AgentWithConfig } from "@/server/services/agents";
import { applicableApprovalRules, applicablePolicies, internalDomains } from "@/server/services/permissions";
import { evaluatePermission } from "@/lib/permissions/engine";
import { ToolsMatrix } from "./tools-matrix";

export async function ToolsTab({ agent, orgId, canEdit }: { agent: AgentWithConfig; orgId: string; canEdit: boolean }) {
  const [tools, policies, rules, domains] = await Promise.all([
    prisma.tool.findMany({
      where: { orgId, deletedAt: null },
      include: { connection: { select: { name: true, status: true } } },
      orderBy: [{ integrationKey: "asc" }, { name: "asc" }],
    }),
    applicablePolicies(orgId, agent.id, agent.departmentId),
    applicableApprovalRules(orgId, agent.id, agent.departmentId),
    internalDomains(orgId),
  ]);

  const rows = tools.map((t) => {
    const grant = agent.tools.find((x) => x.toolId === t.id)?.effect ?? null;
    // Preview with an empty input: input-dependent rules (e.g. recipient) are evaluated per action at runtime.
    const decision = evaluatePermission({
      tool: { key: t.key, name: t.name, riskLevel: t.riskLevel, capabilities: t.capabilities, enabled: t.enabled, deleted: false },
      liveGrant: grant ?? "ALLOW",
      agentPaused: false,
      policies,
      approvalRules: rules,
      action: { toolKey: t.key, capabilities: t.capabilities, risk: t.riskLevel, input: {}, agentId: agent.id, departmentId: agent.departmentId, internalDomains: domains },
    });
    return {
      id: t.id,
      key: t.key,
      name: t.name,
      description: t.description,
      riskLevel: t.riskLevel,
      capabilities: t.capabilities,
      isSimulated: t.isSimulated,
      enabled: t.enabled,
      connection: t.connection ? { name: t.connection.name, status: t.connection.status } : null,
      grant,
      policyNotes: decision.checks.filter((c) => c.layer !== "agent" && c.outcome !== "ALLOW").map((c) => ({ outcome: c.outcome, reason: c.reason })),
    };
  });

  return <ToolsMatrix agentId={agent.id} agentName={agent.name} rows={rows} canEdit={canEdit} />;
}
