import { prisma, type Db } from "@/lib/db";
import type { ActivityCategory, ActorType, AuditOutcome } from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";
import { redact, summarizeForLog } from "@/lib/security/redact";

export interface AuditInput {
  orgId?: string | null;
  actorType: ActorType;
  actorUserId?: string | null;
  actorAgentId?: string | null;
  actorApiKeyId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  outcome?: AuditOutcome;
  runId?: string;
  taskId?: string;
  workflowRunId?: string;
  stepId?: string;
  toolKey?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only security log. Metadata is redacted and size-capped before insert;
 * a failure to audit is logged but never breaks the calling operation.
 */
export async function writeAudit(input: AuditInput, db: Db = prisma) {
  try {
    await db.auditLog.create({
      data: {
        ...input,
        orgId: input.orgId ?? null,
        outcome: input.outcome ?? "SUCCESS",
        metadata: input.metadata ? (summarizeForLog(input.metadata) as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write audit log", { action: input.action, err: String(err) });
  }
}

export interface ActivityInput {
  orgId: string;
  category: ActivityCategory;
  actorType: ActorType;
  actorUserId?: string | null;
  actorAgentId?: string | null;
  summary: string;
  detail?: string;
  entityType?: string;
  entityId?: string;
  link?: string;
  isSimulation?: boolean;
}

/** Human-readable operational feed item ("Sarah completed lead qualification."). */
export async function recordActivity(input: ActivityInput, db: Db = prisma) {
  return db.activityLog.create({
    data: { ...input, detail: input.detail ? String(redact(input.detail)) : undefined },
  });
}
