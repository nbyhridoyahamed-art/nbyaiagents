import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import type { Plan } from "@/lib/generated/prisma/enums";
import { entitlementsFor, percentOf } from "@/lib/billing/entitlements";
import { env } from "@/lib/env";
import { writeAudit } from "@/server/services/audit";
import { setDisabled, getDisabled } from "@/server/services/platform-settings";

/** Platform-wide read models and actions for super admins (spec §122, Phase 17). */

const DAY = 86_400_000;
const since = (days: number) => new Date(Date.now() - days * DAY);
const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

export async function getAdminOverview() {
  const [orgs, suspended, users, disabled, agents, runs24h, runs30d, failed24h, cost30d, newOrgs7d] = await Promise.all([
    prisma.organization.count({ where: { deletedAt: null } }),
    prisma.organization.count({ where: { deletedAt: null, suspendedAt: { not: null } } }),
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, disabledAt: { not: null } } }),
    prisma.agent.count({ where: { deletedAt: null } }),
    prisma.workflowRun.count({ where: { createdAt: { gte: since(1) }, mode: "LIVE" } }),
    prisma.workflowRun.count({ where: { createdAt: { gte: since(30) }, mode: "LIVE" } }),
    Promise.all([
      prisma.agentRun.count({ where: { createdAt: { gte: since(1) }, status: "FAILED" } }),
      prisma.workflowRun.count({ where: { createdAt: { gte: since(1) }, status: "FAILED" } }),
      prisma.job.count({ where: { updatedAt: { gte: since(1) }, status: { in: ["FAILED", "DEAD"] } } }),
    ]).then((xs) => xs.reduce((a, b) => a + b, 0)),
    prisma.usageRecord.aggregate({ where: { kind: "AI_TOKENS", createdAt: { gte: since(30) } }, _sum: { costUsd: true } }),
    prisma.organization.count({ where: { deletedAt: null, createdAt: { gte: since(7) } } }),
  ]);
  return { orgs, suspended, users, disabled, agents, runs24h, runs30d, errors24h: failed24h, cost30d: cost30d._sum.costUsd ?? 0, newOrgs7d };
}

export async function listOrganizationsForAdmin(q?: string) {
  const orgs = await prisma.organization.findMany({
    where: { deletedAt: null, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { _count: { select: { members: true, agents: { where: { deletedAt: null } }, workflows: { where: { deletedAt: null } } } } },
  });
  const ids = orgs.map((o) => o.id);
  const [runs, cost] = await Promise.all([
    prisma.workflowRun.groupBy({ by: ["orgId"], where: { orgId: { in: ids }, createdAt: { gte: since(30) }, mode: "LIVE" }, _count: true }),
    prisma.usageRecord.groupBy({ by: ["orgId"], where: { orgId: { in: ids }, kind: "AI_TOKENS", createdAt: { gte: since(30) } }, _sum: { costUsd: true } }),
  ]);
  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    plan: o.plan,
    isDemo: o.isDemo,
    members: o._count.members,
    agents: o._count.agents,
    workflows: o._count.workflows,
    runs30d: runs.find((r) => r.orgId === o.id)?._count ?? 0,
    cost30d: cost.find((c) => c.orgId === o.id)?._sum.costUsd ?? 0,
    createdAt: o.createdAt.toISOString(),
    suspendedAt: o.suspendedAt?.toISOString() ?? null,
    suspendedReason: o.suspendedReason,
  }));
}

export async function listUsersForAdmin(q?: string) {
  const users = await prisma.user.findMany({
    where: { deletedAt: null, ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { memberships: { include: { organization: { select: { name: true } } } } },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    platformRole: u.platformRole,
    verified: !!u.emailVerifiedAt,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    disabledAt: u.disabledAt?.toISOString() ?? null,
    orgs: u.memberships.map((m) => ({ name: m.organization.name, role: m.role })),
  }));
}

/** Per-company usage this month against plan entitlements (billing-ready, spec §121). */
export async function getUsageReport() {
  const start = monthStart();
  const orgs = await prisma.organization.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, plan: true, _count: { select: { members: true, agents: { where: { deletedAt: null } } } } },
    orderBy: { name: "asc" },
  });
  const ids = orgs.map((o) => o.id);
  const [usage, runs, storage] = await Promise.all([
    prisma.usageRecord.groupBy({ by: ["orgId", "kind"], where: { orgId: { in: ids }, createdAt: { gte: start } }, _count: true, _sum: { inputTokens: true, outputTokens: true, costUsd: true, quantity: true } }),
    prisma.workflowRun.groupBy({ by: ["orgId"], where: { orgId: { in: ids }, createdAt: { gte: start } }, _count: true }),
    prisma.storedFile.groupBy({ by: ["orgId"], where: { orgId: { in: ids } }, _sum: { size: true } }),
  ]);
  return orgs.map((o) => {
    const u = (kind: string) => usage.find((x) => x.orgId === o.id && x.kind === kind);
    const ai = u("AI_TOKENS");
    const ent = entitlementsFor(o.plan);
    const aiCalls = ai?._count ?? 0;
    const workflowRuns = runs.find((r) => r.orgId === o.id)?._count ?? 0;
    const storageMb = Math.round(((storage.find((s) => s.orgId === o.id)?._sum.size ?? 0) / 1_048_576) * 10) / 10;
    const apiRequests = u("API_REQUEST")?._count ?? 0;
    return {
      id: o.id,
      name: o.name,
      plan: o.plan,
      agents: { used: o._count.agents, limit: ent.agents, pct: percentOf(o._count.agents, ent.agents) },
      members: { used: o._count.members, limit: ent.members, pct: percentOf(o._count.members, ent.members) },
      aiCalls: { used: aiCalls, limit: ent.aiCallsPerMonth, pct: percentOf(aiCalls, ent.aiCallsPerMonth) },
      tokens: (ai?._sum.inputTokens ?? 0) + (ai?._sum.outputTokens ?? 0),
      costUsd: ai?._sum.costUsd ?? 0,
      toolCalls: u("TOOL_CALL")?._count ?? 0,
      workflowRuns: { used: workflowRuns, limit: ent.workflowRunsPerMonth, pct: percentOf(workflowRuns, ent.workflowRunsPerMonth) },
      storageMb: { used: storageMb, limit: ent.storageMb, pct: percentOf(storageMb, ent.storageMb) },
      apiRequests: { used: apiRequests, limit: ent.apiRequestsPerMonth, pct: percentOf(apiRequests, ent.apiRequestsPerMonth) },
    };
  });
}

export async function getPlatformErrors(limit = 40) {
  const [agentRuns, workflowRuns, jobs] = await Promise.all([
    prisma.agentRun.findMany({ where: { status: "FAILED", createdAt: { gte: since(7) } }, orderBy: { createdAt: "desc" }, take: limit, include: { agent: { select: { name: true, organization: { select: { name: true } } } } } }),
    prisma.workflowRun.findMany({ where: { status: "FAILED", createdAt: { gte: since(7) } }, orderBy: { createdAt: "desc" }, take: limit, include: { workflow: { select: { name: true, organization: { select: { name: true } } } } } }),
    prisma.job.findMany({ where: { status: { in: ["FAILED", "DEAD"] } }, orderBy: { updatedAt: "desc" }, take: limit }),
  ]);
  const orgNames = new Map((await prisma.organization.findMany({ where: { id: { in: jobs.map((j) => j.orgId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
  return [
    ...agentRuns.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), source: "Employee run", org: r.agent.organization.name, subject: r.agent.name, message: r.error ?? "Failed", simulation: r.mode === "SIMULATION" })),
    ...workflowRuns.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), source: "Workflow run", org: r.workflow.organization.name, subject: r.workflow.name, message: r.error ?? "Failed", simulation: r.mode === "SIMULATION" })),
    ...jobs.map((j) => ({ id: j.id, at: j.updatedAt.toISOString(), source: j.status === "DEAD" ? "Job (gave up)" : "Job", org: j.orgId ? (orgNames.get(j.orgId) ?? "—") : "—", subject: j.name, message: j.lastError ?? "Failed", simulation: false })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

export async function getSystemHealth() {
  const started = Date.now();
  let dbOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  const dbLatencyMs = Date.now() - started;
  const [pending, running, failed, dead, oldestPending, processed5m, stuck] = await Promise.all([
    prisma.job.count({ where: { status: "PENDING", runAt: { lte: new Date() } } }),
    prisma.job.count({ where: { status: "RUNNING" } }),
    prisma.job.count({ where: { status: "FAILED" } }),
    prisma.job.count({ where: { status: "DEAD" } }),
    prisma.job.findFirst({ where: { status: "PENDING", runAt: { lte: new Date() } }, orderBy: { runAt: "asc" }, select: { runAt: true } }),
    prisma.job.count({ where: { status: "COMPLETED", completedAt: { gte: new Date(Date.now() - 5 * 60_000) } } }),
    prisma.job.count({ where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - 15 * 60_000) } } }),
  ]);
  const e = env();
  const oldestPendingSec = oldestPending ? Math.round((Date.now() - oldestPending.runAt.getTime()) / 1000) : 0;
  return {
    database: { ok: dbOk, latencyMs: dbLatencyMs },
    queue: {
      driver: e.REDIS_URL ? "Redis (BullMQ)" : "PostgreSQL",
      pending,
      running,
      failed,
      dead,
      stuck,
      oldestPendingSec,
      processed5m,
      // A backlog that sits for minutes means no worker is picking jobs up.
      workerOk: pending === 0 || oldestPendingSec < 120,
    },
    config: {
      ai: { anthropic: !!e.ANTHROPIC_API_KEY, openai: !!e.OPENAI_API_KEY, google: !!e.GOOGLE_API_KEY },
      email: e.EMAIL_PROVIDER,
      storage: e.STORAGE_DRIVER ?? "local",
      encryptionKey: !!e.ENCRYPTION_KEY,
      appUrl: e.APP_URL,
      nodeEnv: process.env.NODE_ENV ?? "development",
    },
  };
}

// ── Actions (all audited) ───────────────────────────────────────────────────

async function adminAudit(adminId: string, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>, orgId?: string) {
  await writeAudit({ orgId: orgId ?? null, actorType: "USER", actorUserId: adminId, action: `admin.${action}`, entityType, entityId, metadata });
}

export async function setOrganizationPlan(adminId: string, orgId: string, plan: Plan) {
  const org = await prisma.organization.findFirst({ where: { id: orgId, deletedAt: null } });
  if (!org) throw notFound("Organization");
  await prisma.organization.update({ where: { id: orgId }, data: { plan } });
  await adminAudit(adminId, "org.plan", "Organization", orgId, { from: org.plan, to: plan }, orgId);
}

export async function setOrganizationSuspended(adminId: string, orgId: string, suspended: boolean, reason?: string) {
  const org = await prisma.organization.findFirst({ where: { id: orgId, deletedAt: null } });
  if (!org) throw notFound("Organization");
  if (suspended && !reason?.trim()) throw new AppError("VALIDATION", "Give a reason for the suspension.", { fieldErrors: { reason: "Give a reason." } });
  await prisma.organization.update({ where: { id: orgId }, data: suspended ? { suspendedAt: new Date(), suspendedReason: reason!.trim().slice(0, 500) } : { suspendedAt: null, suspendedReason: null } });
  if (suspended) {
    // Stop anything scheduled from firing while suspended.
    await prisma.schedule.updateMany({ where: { orgId }, data: { enabled: false } });
  } else {
    await prisma.schedule.updateMany({ where: { orgId, workflow: { status: "ACTIVE" } }, data: { enabled: true } });
  }
  await adminAudit(adminId, suspended ? "org.suspend" : "org.reactivate", "Organization", orgId, { reason }, orgId);
}

export async function setUserDisabled(adminId: string, userId: string, disabled: boolean) {
  if (adminId === userId) throw new AppError("VALIDATION", "You can't disable your own account.");
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw notFound("User");
  await prisma.user.update({ where: { id: userId }, data: { disabledAt: disabled ? new Date() : null } });
  if (disabled) await prisma.session.deleteMany({ where: { userId } });
  await adminAudit(adminId, disabled ? "user.disable" : "user.enable", "User", userId);
}

export async function setUserPlatformRole(adminId: string, userId: string, role: "USER" | "SUPER_ADMIN") {
  if (adminId === userId && role !== "SUPER_ADMIN") throw new AppError("VALIDATION", "You can't remove your own admin access.");
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw notFound("User");
  await prisma.user.update({ where: { id: userId }, data: { platformRole: role } });
  await adminAudit(adminId, "user.role", "User", userId, { from: user.platformRole, to: role });
}

export async function setCatalogItemEnabled(adminId: string, kind: "integrations" | "templates", key: string, enabled: boolean) {
  const settingKey = kind === "integrations" ? "integrations.disabled" : "templates.disabled";
  const current = await getDisabled(settingKey);
  const next = enabled ? current.filter((k) => k !== key) : [...current, key];
  await setDisabled(settingKey, next, adminId);
  await adminAudit(adminId, `${kind}.${enabled ? "enable" : "disable"}`, kind === "integrations" ? "Integration" : "Template", key);
}
