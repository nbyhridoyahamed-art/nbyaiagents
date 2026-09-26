import { NextResponse } from "next/server";
import { withApiKey } from "@/lib/api/http";
import { listWorkflowsForApi } from "@/server/services/public-api";

/** GET /api/v1/workflows — the company's workflows. Scope: workflows:read */
export async function GET(request: Request) {
  return withApiKey(request, "workflows:read", async (p) => NextResponse.json({ data: await listWorkflowsForApi(p.orgId) }));
}
