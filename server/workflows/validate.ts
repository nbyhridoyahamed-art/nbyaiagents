import { prisma } from "@/lib/db";
import { getIntegration } from "@/lib/integrations/catalog";
import { validateCron } from "@/lib/workflows/schedule";
import { loopBody, validateGraph, type GraphIssue } from "@/lib/workflows/validate-graph";
import type { WorkflowGraph } from "@/lib/workflows/types";
import { effectiveToolMeta } from "@/server/tools/executor";

/**
 * Full validation: structure + environment (spec §112). Messages are written
 * for owners, with a fix link wherever possible.
 */
export async function validateWorkflowGraph(orgId: string, graph: WorkflowGraph, opts: { forPublish: boolean; defaultAgentId?: string | null }): Promise<GraphIssue[]> {
  const issues = validateGraph(graph);
  const agentIds = new Set<string>();
  const toolKeys = new Set<string>();
  for (const n of graph.nodes) {
    const c = n.config as { agentId?: string; toolKey?: string };
    if (c.agentId) agentIds.add(c.agentId);
    if (c.toolKey) toolKeys.add(c.toolKey);
  }
  if (opts.defaultAgentId) agentIds.add(opts.defaultAgentId);

  const [agents, tools] = await Promise.all([
    prisma.agent.findMany({ where: { orgId, id: { in: [...agentIds] } }, include: { tools: true } }),
    prisma.tool.findMany({ where: { orgId, key: { in: [...toolKeys] } }, include: { connection: true, credential: true } }),
  ]);

  for (const n of graph.nodes) {
    const c = n.config as { agentId?: string; toolKey?: string; cron?: string };

    if (c.agentId) {
      const a = agents.find((x) => x.id === c.agentId);
      if (!a || a.deletedAt) issues.push({ level: "error", message: `“${n.label}” uses an AI employee who no longer exists.`, nodeKey: n.key });
      else if (a.status === "PAUSED") issues.push({ level: opts.forPublish ? "warning" : "warning", message: `${a.name} is paused, so “${n.label}” will fail until they're resumed.`, nodeKey: n.key, fix: { label: `Open ${a.name}`, href: `/agents/${a.id}` } });
      else if (opts.forPublish && a.publishedVersion === null) {
        issues.push({ level: "error", message: `${a.name} is still a draft. Publish ${a.name} before this workflow can run live.`, nodeKey: n.key, fix: { label: `Publish ${a.name}`, href: `/agents/${a.id}` } });
      }
    }

    if (n.type === "tool.call" && c.toolKey) {
      const t = tools.find((x) => x.key === c.toolKey);
      const actingAgent = agents.find((x) => x.id === (c.agentId ?? opts.defaultAgentId));
      if (!t || t.deletedAt) {
        issues.push({ level: "error", message: `“${n.label}” uses a tool that no longer exists.`, nodeKey: n.key, fix: { label: "Open tools", href: "/tools" } });
        continue;
      }
      const integration = t.integrationKey ? getIntegration(t.integrationKey) : undefined;
      const who = actingAgent?.name ?? "This workflow";
      if (t.connection && t.connection.status !== "CONNECTED") {
        issues.push({
          level: "error",
          message: `${who} uses ${t.name}, but ${integration?.name ?? "its integration"} is not connected.`,
          nodeKey: n.key,
          fix: { label: `Connect ${integration?.name ?? "integration"}`, href: "/integrations" },
        });
      } else if (!t.enabled) {
        issues.push({ level: "error", message: `${t.name} is disabled.`, nodeKey: n.key, fix: { label: "Enable tool", href: `/tools/${t.id}` } });
      }
      if (t.credentialId && (!t.credential || t.credential.revokedAt)) {
        issues.push({ level: "error", message: `${t.name}'s credential was revoked. Add a new one.`, nodeKey: n.key, fix: { label: "Fix credential", href: `/tools/${t.id}?edit=1` } });
      }
      const meta = effectiveToolMeta(t);
      if (actingAgent) {
        const grant = actingAgent.tools.find((g) => g.toolId === t.id);
        if (!grant || grant.effect === "DENY") {
          issues.push({
            level: "error",
            message: `${actingAgent.name} isn't allowed to use ${t.name}. Grant the permission or pick another employee.`,
            nodeKey: n.key,
            fix: { label: "Set permission", href: `/agents/${actingAgent.id}?tab=tools` },
          });
        }
      } else if (meta.riskLevel !== "LOW") {
        issues.push({
          level: "warning",
          message: `“${n.label}” runs without an employee, so this ${meta.riskLevel.toLowerCase()}-risk action will always ask for approval. Choose an employee to use their permissions.`,
          nodeKey: n.key,
        });
      }
    }

    if (n.type === "trigger.schedule" && c.cron) {
      const cronErr = validateCron(c.cron);
      if (cronErr) issues.push({ level: "error", message: cronErr, nodeKey: n.key });
    }
  }

  // Tools inside loops can't wait for approval.
  for (const loop of graph.nodes.filter((x) => x.type === "logic.loop")) {
    for (const k of loopBody(graph, loop.key)) {
      const n = graph.nodes.find((x) => x.key === k);
      const t = n?.type === "tool.call" ? tools.find((x) => x.key === (n.config as { toolKey?: string }).toolKey) : undefined;
      if (t && effectiveToolMeta(t).riskLevel !== "LOW") {
        issues.push({ level: "warning", message: `${t.name} inside a loop can't pause for approval; if approval is required that item will fail.`, nodeKey: k });
      }
    }
  }
  return issues;
}
