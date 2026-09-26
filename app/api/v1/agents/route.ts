import { NextResponse } from "next/server";
import { withApiKey } from "@/lib/api/http";
import { listAgentsForApi } from "@/server/services/public-api";

/** GET /api/v1/agents — the company's AI employees. Scope: agents:read */
export async function GET(request: Request) {
  return withApiKey(request, "agents:read", async (p) => NextResponse.json({ data: await listAgentsForApi(p.orgId) }));
}
