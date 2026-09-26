import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/actor";
import { writeAudit } from "@/server/services/audit";

export async function listDepartments(orgId: string) {
  const departments = await prisma.department.findMany({
    where: { orgId, deletedAt: null },
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          agents: { where: { deletedAt: null } },
          workflows: { where: { deletedAt: null } },
          tasks: { where: { deletedAt: null, status: { in: ["QUEUED", "RUNNING", "WAITING", "AWAITING_APPROVAL"] } } },
          knowledge: true,
          policies: true,
        },
      },
    },
  });
  return departments;
}

export interface DepartmentInput {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
}

export async function createDepartment(actor: Actor, input: DepartmentInput) {
  const exists = await prisma.department.findFirst({ where: { orgId: actor.orgId, name: { equals: input.name.trim(), mode: "insensitive" }, deletedAt: null } });
  if (exists) throw new AppError("CONFLICT", "A department with that name already exists.", { fieldErrors: { name: "Name already used." } });
  // Re-activate a soft-deleted department with the same name (unique constraint).
  const deleted = await prisma.department.findFirst({ where: { orgId: actor.orgId, name: input.name.trim(), deletedAt: { not: null } } });
  const dept = deleted
    ? await prisma.department.update({ where: { id: deleted.id }, data: { deletedAt: null, description: input.description || null, color: input.color, icon: input.icon } })
    : await prisma.department.create({
        data: { orgId: actor.orgId, name: input.name.trim(), description: input.description || null, color: input.color ?? "#5B5FEF", icon: input.icon ?? "building-2" },
      });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "department.create", entityType: "Department", entityId: dept.id });
  return dept;
}

export async function updateDepartment(actor: Actor, id: string, input: DepartmentInput) {
  const dept = await prisma.department.findFirst({ where: { id, orgId: actor.orgId, deletedAt: null } });
  if (!dept) throw notFound("Department");
  if (input.name.trim().toLowerCase() !== dept.name.toLowerCase()) {
    const clash = await prisma.department.findFirst({ where: { orgId: actor.orgId, name: { equals: input.name.trim(), mode: "insensitive" }, id: { not: id } } });
    if (clash) throw new AppError("CONFLICT", "A department with that name already exists.", { fieldErrors: { name: "Name already used." } });
  }
  const updated = await prisma.department.update({
    where: { id },
    data: { name: input.name.trim(), description: input.description || null, color: input.color, icon: input.icon },
  });
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "department.update", entityType: "Department", entityId: id });
  return updated;
}

/** Soft-deletes; employees and workflows are kept but become unassigned. */
export async function deleteDepartment(actor: Actor, id: string) {
  const dept = await prisma.department.findFirst({ where: { id, orgId: actor.orgId, deletedAt: null } });
  if (!dept) throw notFound("Department");
  await prisma.$transaction([
    prisma.agent.updateMany({ where: { departmentId: id }, data: { departmentId: null } }),
    prisma.workflow.updateMany({ where: { departmentId: id }, data: { departmentId: null } }),
    prisma.knowledgeAssignment.deleteMany({ where: { departmentId: id } }),
    prisma.department.update({ where: { id }, data: { deletedAt: new Date() } }),
  ]);
  await writeAudit({ orgId: actor.orgId, actorType: actor.type, actorUserId: actor.userId, action: "department.delete", entityType: "Department", entityId: id });
}
