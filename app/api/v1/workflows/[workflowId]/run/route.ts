import { NextResponse } from "next/server";
import { parseBody, readJson, withApiKey } from "@/lib/api/http";
import { runWorkflowForApi, workflowRunBody } from "@/server/services/public-api";

/**
 * POST /api/v1/workflows/{workflowId}/run — start the published version. Send an
 * `Idempotency-Key` header to make retries safe. Scope: workflows:run
 */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/workflows/[workflowId]/run">) {
  return withApiKey(request, "workflows:run", async (p) => {
    const { workflowId } = await ctx.params;
    const body = parseBody(workflowRunBody, await readJson(request, false));
    const run = await runWorkflowForApi(p, workflowId, body, request.headers.get("idempotency-key"));
    return NextResponse.json({ data: run, links: { run: `/api/v1/workflow-runs/${run.id}` } }, { status: 202 });
  });
}
