import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import { DEFAULT_DEPARTMENTS, DEFAULT_ORG_POLICIES } from "@/lib/policies/defaults";
import { recordActivity, writeAudit } from "@/server/services/audit";

export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 40) || "company"
  );
}

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

async function uniqueSlug(base: string) {
  let slug = base;
  for (let i = 0; i < 20; i++) {
    const taken = await prisma.organization.findUnique({ where: { slug } });
    if (!taken) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  throw new AppError("CONFLICT", "Could not allocate a workspace URL. Try another name.");
}

export interface CreateOrganizationInput {
  name: string;
  timezone: string;
  industry?: string;
  companySize?: string;
  website?: string;
  description?: string;
  businessGoals?: string[];
}

/**
 * Creates a company workspace owned by `userId`, with default departments, the
 * default company AI policy and the default approval rule for external email.
 */
export async function createOrganization(userId: string, input: CreateOrganizationInput, sessionId?: string) {
  if (!isValidTimezone(input.timezone)) {
    throw new AppError("VALIDATION", "Unknown timezone.", { fieldErrors: { timezone: "Choose a valid timezone." } });
  }
  const slug = await uniqueSlug(slugify(input.name));

  const org = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: input.name.trim(),
        slug,
        timezone: input.timezone,
        industry: input.industry || null,
        companySize: input.companySize || null,
        website: input.website || null,
        description: input.description || null,
        businessGoals: input.businessGoals ?? [],
        members: { create: { userId, role: "OWNER" } },
        departments: { create: DEFAULT_DEPARTMENTS.map((d) => ({ name: d.name, color: d.color, icon: d.icon })) },
        policies: {
          create: DEFAULT_ORG_POLICIES.map((p) => ({
            name: p.name,
            rule: p.rule,
            scope: "ORGANIZATION" as const,
            enforcement: (p.enforcement ?? undefined) as Prisma.InputJsonValue | undefined,
          })),
        },
        approvalPolicies: {
          create: [
            {
              name: "External email needs approval",
              description: "Any email sent to a recipient outside the company requires human approval.",
              conditions: { all: [{ field: "capability", op: "includes", value: "external_communication" }] },
              effect: "REQUIRE_APPROVAL",
              priority: 10,
            },
            {
              name: "High-risk actions need approval",
              description: "Actions rated high or critical risk always pause for a human.",
              conditions: { all: [{ field: "risk", op: "gte", value: "HIGH" }] },
              effect: "REQUIRE_APPROVAL",
              priority: 20,
            },
          ],
        },
      },
    });
    if (sessionId) {
      await tx.session.update({ where: { id: sessionId }, data: { activeOrganizationId: org.id } });
    }
    return org;
  });

  await writeAudit({ orgId: org.id, actorType: "USER", actorUserId: userId, action: "org.create", entityType: "Organization", entityId: org.id });
  await recordActivity({
    orgId: org.id,
    category: "SYSTEM",
    actorType: "USER",
    actorUserId: userId,
    summary: `${org.name} workspace created.`,
  });
  return org;
}

export async function updateOrganization(
  orgId: string,
  actorUserId: string,
  data: Partial<CreateOrganizationInput> & { monthlyAiBudgetUsd?: number },
) {
  if (data.timezone && !isValidTimezone(data.timezone)) {
    throw new AppError("VALIDATION", "Unknown timezone.", { fieldErrors: { timezone: "Choose a valid timezone." } });
  }
  const org = await prisma.organization.update({
    where: { id: orgId },
    data: {
      name: data.name?.trim(),
      timezone: data.timezone,
      industry: data.industry,
      companySize: data.companySize,
      website: data.website,
      description: data.description,
      businessGoals: data.businessGoals,
      monthlyAiBudgetUsd: data.monthlyAiBudgetUsd,
    },
  });
  await writeAudit({ orgId, actorType: "USER", actorUserId, action: "org.update", entityType: "Organization", entityId: orgId, metadata: data });
  return org;
}

export async function listUserOrganizations(userId: string) {
  return prisma.organizationMember.findMany({
    where: { userId, organization: { deletedAt: null } },
    include: { organization: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function switchOrganization(sessionId: string, userId: string, orgId: string) {
  const membership = await prisma.organizationMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
  if (!membership) throw new AppError("FORBIDDEN", "You are not a member of that workspace.");
  await prisma.session.update({ where: { id: sessionId }, data: { activeOrganizationId: orgId } });
}
