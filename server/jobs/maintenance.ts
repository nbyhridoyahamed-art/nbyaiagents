import { prisma } from "@/lib/db";

/** Periodic housekeeping: expired sessions/tokens, stale rate-limit buckets, old completed jobs, expired approvals. */
export async function runCleanup() {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  await Promise.all([
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.verificationToken.deleteMany({ where: { OR: [{ expiresAt: { lt: dayAgo } }, { usedAt: { lt: dayAgo } }] } }),
    prisma.rateLimitBucket.deleteMany({ where: { updatedAt: { lt: dayAgo } } }),
    prisma.job.deleteMany({ where: { status: "COMPLETED", completedAt: { lt: monthAgo } } }),
    prisma.idempotencyRecord.deleteMany({ where: { status: "COMPLETED", updatedAt: { lt: monthAgo } } }),
  ]);
  // Expire approvals nobody decided; the paused work is informed via the normal resume path.
  const expired = await prisma.approval.findMany({ where: { status: "PENDING", expiresAt: { lt: now } }, take: 100 });
  for (const a of expired) {
    await prisma.approval.update({ where: { id: a.id }, data: { status: "EXPIRED" } });
    const { enqueue } = await import("@/server/jobs/queue");
    if (a.agentRunId) await enqueue("agent.resume", { runId: a.agentRunId, approvalId: a.id }, { orgId: a.orgId });
    else if (a.workflowRunId) await enqueue("workflow.advance", { workflowRunId: a.workflowRunId, approvalId: a.id }, { orgId: a.orgId });
  }
}
