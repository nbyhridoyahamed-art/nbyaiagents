import { NextResponse } from "next/server";
import { withApiKey } from "@/lib/api/http";
import { getTaskForApi } from "@/server/services/public-api";

/** GET /api/v1/tasks/{taskId} — status and result of a task. Scope: tasks:read */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/tasks/[taskId]">) {
  return withApiKey(request, "tasks:read", async (p) => {
    const { taskId } = await ctx.params;
    return NextResponse.json({ data: await getTaskForApi(p.orgId, taskId) });
  });
}
