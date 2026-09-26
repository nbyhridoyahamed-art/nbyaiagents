import { prisma } from "@/lib/db";

/**
 * Markers on bulk-generated demo history (spec §127–128). Only rows carrying a
 * marker are ever removed by `removeDemoHistory`, so real work done inside the
 * demo workspace is never touched.
 */
export const DEMO_MARK = "nby-demo-seed";
export const DEMO_TASK_INPUTS = { demoSeed: DEMO_MARK } as const;
export const DEMO_ACTIVITY_ENTITY = "DemoSeed";
export const DEMO_USAGE_MODEL = "demo-seed";

export async function removeDemoHistory(orgId: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { isDemo: true } });
  if (!org.isDemo) throw new Error("Refusing to remove demo history from a workspace that isn't marked as a demo.");
  const demoTasks = await prisma.task.findMany({ where: { orgId, inputs: { path: ["demoSeed"], equals: DEMO_MARK } }, select: { id: true } });
  const taskIds = demoTasks.map((t) => t.id);
  const [runs, tasks, wfRuns, usage, activity] = await prisma.$transaction([
    prisma.agentRun.deleteMany({ where: { orgId, OR: [{ taskId: { in: taskIds } }, { state: { path: ["demoSeed"], equals: DEMO_MARK } }] } }),
    prisma.task.deleteMany({ where: { orgId, id: { in: taskIds } } }),
    prisma.workflowRun.deleteMany({ where: { orgId, triggerPayload: { path: ["demoSeed"], equals: DEMO_MARK } } }),
    prisma.usageRecord.deleteMany({ where: { orgId, model: DEMO_USAGE_MODEL } }),
    prisma.activityLog.deleteMany({ where: { orgId, entityType: DEMO_ACTIVITY_ENTITY } }),
  ]);
  return { runs: runs.count, tasks: tasks.count, workflowRuns: wfRuns.count, usage: usage.count, activity: activity.count };
}
