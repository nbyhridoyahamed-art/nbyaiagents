import { NextResponse } from "next/server";
import { parseBody, readJson, withApiKey } from "@/lib/api/http";
import { agentRunBody, runAgentForApi } from "@/server/services/public-api";

/**
 * POST /api/v1/agents/{agentId}/run — give an employee work. Creates a task that runs
 * in the background; poll GET /api/v1/tasks/{id}. Scope: agents:run
 */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/agents/[agentId]/run">) {
  return withApiKey(request, "agents:run", async (p) => {
    const { agentId } = await ctx.params;
    const body = parseBody(agentRunBody, await readJson(request));
    const task = await runAgentForApi(p, agentId, body);
    return NextResponse.json({ data: task, links: { task: `/api/v1/tasks/${task.id}` } }, { status: 202 });
  });
}
