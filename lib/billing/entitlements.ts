import type { Plan } from "@/lib/generated/prisma/enums";

/**
 * Plan entitlements (spec §121). Product code asks "is this allowed?" through these
 * helpers; nothing here knows about a payment provider, so billing can be added later
 * without touching product logic. `null` means unlimited.
 */

export interface Entitlements {
  agents: number | null;
  members: number | null;
  aiCallsPerMonth: number | null;
  workflowRunsPerMonth: number | null;
  storageMb: number | null;
  apiRequestsPerMonth: number | null;
}

export const PLAN_ENTITLEMENTS: Record<Plan, Entitlements> = {
  FREE: { agents: 10, members: 5, aiCallsPerMonth: 2_000, workflowRunsPerMonth: 1_000, storageMb: 500, apiRequestsPerMonth: 10_000 },
  STARTER: { agents: 25, members: 15, aiCallsPerMonth: 20_000, workflowRunsPerMonth: 10_000, storageMb: 5_000, apiRequestsPerMonth: 100_000 },
  GROWTH: { agents: 100, members: 50, aiCallsPerMonth: 200_000, workflowRunsPerMonth: 100_000, storageMb: 50_000, apiRequestsPerMonth: 1_000_000 },
  ENTERPRISE: { agents: null, members: null, aiCallsPerMonth: null, workflowRunsPerMonth: null, storageMb: null, apiRequestsPerMonth: null },
};

export function entitlementsFor(plan: Plan): Entitlements {
  return PLAN_ENTITLEMENTS[plan] ?? PLAN_ENTITLEMENTS.FREE;
}

/** Share of a limit used, 0–100 (null when unlimited). */
export function percentOf(used: number, limit: number | null): number | null {
  if (limit === null) return null;
  if (limit <= 0) return 100;
  return Math.min(100, Math.round((used / limit) * 100));
}
