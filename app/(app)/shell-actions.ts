"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession, requireOrgContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { switchOrganization } from "@/server/services/organizations";

export async function switchOrganizationAction(orgId: string) {
  const session = await getSession();
  if (!session) throw new AppError("UNAUTHENTICATED", "Please sign in.");
  if (typeof orgId !== "string") throw new AppError("VALIDATION", "Invalid workspace.");
  await switchOrganization(session.id, session.userId, orgId);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
  type: string;
}

export async function listNotificationsAction(): Promise<NotificationItem[]> {
  const ctx = await requireOrgContext();
  const rows = await prisma.notification.findMany({
    where: { orgId: ctx.org.id, userId: ctx.user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return rows.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    link: n.link,
    read: !!n.readAt,
    createdAt: n.createdAt.toISOString(),
    type: n.type,
  }));
}

export async function markNotificationsReadAction(ids?: string[]) {
  const ctx = await requireOrgContext();
  await prisma.notification.updateMany({
    where: {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      readAt: null,
      ...(Array.isArray(ids) ? { id: { in: ids.filter((i) => typeof i === "string") } } : {}),
    },
    data: { readAt: new Date() },
  });
  revalidatePath("/", "layout");
}

export interface SearchResult {
  group: "Employees" | "Tasks" | "Workflows" | "Knowledge" | "Tools" | "Conversations";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

/** Global search across the active organization only. */
export async function globalSearchAction(query: string): Promise<SearchResult[]> {
  const ctx = await requireOrgContext();
  const q = typeof query === "string" ? query.trim().slice(0, 100) : "";
  if (q.length < 2) return [];
  const orgId = ctx.org.id;
  const contains = { contains: q, mode: "insensitive" as const };
  const [agents, tasks, workflows, docs, tools, conversations] = await Promise.all([
    prisma.agent.findMany({
      where: { orgId, deletedAt: null, OR: [{ name: contains }, { jobTitle: contains }] },
      take: 5,
      select: { id: true, name: true, jobTitle: true },
    }),
    prisma.task.findMany({ where: { orgId, deletedAt: null, title: contains }, take: 5, select: { id: true, title: true, status: true } }),
    prisma.workflow.findMany({ where: { orgId, deletedAt: null, name: contains }, take: 5, select: { id: true, name: true, status: true } }),
    prisma.knowledgeDocument.findMany({
      where: { orgId, deletedAt: null, title: contains },
      take: 5,
      select: { id: true, title: true, knowledgeBaseId: true },
    }),
    prisma.tool.findMany({ where: { orgId, deletedAt: null, name: contains }, take: 5, select: { id: true, name: true, kind: true } }),
    prisma.conversation.findMany({
      where: { orgId, userId: ctx.user.id, title: contains },
      take: 5,
      select: { id: true, title: true, agentId: true },
    }),
  ]);
  return [
    ...agents.map((a) => ({ group: "Employees" as const, id: a.id, title: a.name, subtitle: a.jobTitle, href: `/agents/${a.id}` })),
    ...tasks.map((t) => ({ group: "Tasks" as const, id: t.id, title: t.title, subtitle: t.status.toLowerCase(), href: `/tasks/${t.id}` })),
    ...workflows.map((w) => ({ group: "Workflows" as const, id: w.id, title: w.name, subtitle: w.status.toLowerCase(), href: `/workflows/${w.id}` })),
    ...docs.map((d) => ({ group: "Knowledge" as const, id: d.id, title: d.title, href: `/knowledge/${d.knowledgeBaseId}` })),
    ...tools.map((t) => ({ group: "Tools" as const, id: t.id, title: t.name, subtitle: t.kind.toLowerCase().replace("_", " "), href: `/tools/${t.id}` })),
    ...conversations.map((c) => ({
      group: "Conversations" as const,
      id: c.id,
      title: c.title,
      href: `/agents/${c.agentId}?tab=chat&conversation=${c.id}`,
    })),
  ];
}
