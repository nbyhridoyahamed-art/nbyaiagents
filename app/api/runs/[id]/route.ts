import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";

/**
 * Live run state for the UI (polled). Returns operational steps only — never
 * model reasoning — plus any conversation messages newer than `after`.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const org = await getOrgContext();
  if (!org) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const run = await prisma.agentRun.findFirst({
    where: { id, orgId: org.org.id },
    select: {
      id: true,
      status: true,
      mode: true,
      error: true,
      conversationId: true,
      agentId: true,
      model: true,
      provider: true,
      steps: { orderBy: { sequence: "asc" }, select: { id: true, type: true, label: true, status: true, outputMeta: true, approvalId: true, error: true } },
    },
  });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const after = new URL(request.url).searchParams.get("after");
  let messages: unknown[] = [];
  if (run.conversationId) {
    const since = after ? await prisma.message.findFirst({ where: { id: after, conversationId: run.conversationId }, select: { createdAt: true } }) : null;
    messages = await prisma.message.findMany({
      where: { conversationId: run.conversationId, ...(since ? { createdAt: { gt: since.createdAt } } : {}) },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, content: true, metadata: true, runId: true, createdAt: true },
    });
  }
  return NextResponse.json(
    {
      run: {
        id: run.id,
        status: run.status,
        mode: run.mode,
        error: run.error,
        offline: run.provider === "OFFLINE",
        steps: run.steps
          .filter((s) => s.type !== "CONTEXT")
          .map((s) => ({
            id: s.id,
            type: s.type,
            label: s.label,
            status: s.status,
            summary: (s.outputMeta as { summary?: string } | null)?.summary ?? null,
            approvalId: s.approvalId,
            error: s.error,
          })),
      },
      messages,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
