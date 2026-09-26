import { NextResponse } from "next/server";
import { withApiKey } from "@/lib/api/http";
import { getWorkflowRunForApi } from "@/server/services/public-api";

/** GET /api/v1/workflow-runs/{runId} — status and output of a workflow run. Scope: workflows:read */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/workflow-runs/[runId]">) {
  return withApiKey(request, "workflows:read", async (p) => {
    const { runId } = await ctx.params;
    return NextResponse.json({ data: await getWorkflowRunForApi(p.orgId, runId) });
  });
}
