import type { Metadata } from "next";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { listDepartments } from "@/server/services/departments";
import { DepartmentsView } from "./departments-view";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  const ctx = await requirePageContext();
  const [departments, agents] = await Promise.all([
    listDepartments(ctx.org.id),
    prisma.agent.findMany({
      where: { orgId: ctx.org.id, deletedAt: null, departmentId: { not: null } },
      select: { id: true, name: true, avatarColor: true, departmentId: true, status: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return (
    <PageContainer>
      <PageHeader title="Departments" description="Group your AI employees, workflows, knowledge and policies the way your company works." />
      <DepartmentsView
        canManage={ctx.can("departments:manage")}
        departments={departments.map((d) => ({
          id: d.id,
          name: d.name,
          description: d.description,
          color: d.color,
          icon: d.icon,
          counts: {
            agents: d._count.agents,
            workflows: d._count.workflows,
            openTasks: d._count.tasks,
            knowledge: d._count.knowledge,
            policies: d._count.policies,
          },
          agents: agents.filter((a) => a.departmentId === d.id).map((a) => ({ id: a.id, name: a.name, color: a.avatarColor, status: a.status })),
        }))}
      />
    </PageContainer>
  );
}
