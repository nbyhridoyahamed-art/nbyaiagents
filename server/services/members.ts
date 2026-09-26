import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError, notFound } from "@/lib/errors";
import type { OrgRole } from "@/lib/generated/prisma/enums";
import { canAssignRole, ROLE_LABELS } from "@/lib/permissions/rbac";
import { randomToken, sha256 } from "@/lib/security/crypto";
import { normalizeEmail } from "@/server/services/auth";
import { recordActivity, writeAudit } from "@/server/services/audit";
import { sendEmail } from "@/server/services/email";
import type { Actor } from "@/lib/auth/actor";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function actorRole(orgId: string, userId: string): Promise<OrgRole> {
  const m = await prisma.organizationMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
  if (!m) throw new AppError("FORBIDDEN", "You are not a member of this workspace.");
  return m.role;
}

export async function listMembers(orgId: string) {
  const [members, invitations] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { orgId },
      include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true, emailVerifiedAt: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invitation.findMany({
      where: { orgId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { members, invitations };
}

export async function inviteMember(actor: Actor & { userId: string }, emailInput: string, role: OrgRole) {
  const email = normalizeEmail(emailInput);
  const role0 = await actorRole(actor.orgId, actor.userId);
  if (!canAssignRole(role0, role)) throw new AppError("FORBIDDEN", `You can't invite someone as ${ROLE_LABELS[role].label}.`);

  const existingMember = await prisma.organizationMember.findFirst({ where: { orgId: actor.orgId, user: { email } } });
  if (existingMember) throw new AppError("CONFLICT", "That person is already a member.", { fieldErrors: { email: "Already a member." } });

  const token = randomToken(32);
  await prisma.invitation.updateMany({
    where: { orgId: actor.orgId, email, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  const invitation = await prisma.invitation.create({
    data: {
      orgId: actor.orgId,
      email,
      role,
      tokenHash: sha256(token),
      invitedById: actor.userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
    include: { organization: true },
  });
  const inviter = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  const link = `${env().APP_URL}/invite/${token}`;
  await sendEmail({
    to: email,
    orgId: actor.orgId,
    template: "invitation",
    subject: `${inviter.name} invited you to ${invitation.organization.name} on NBY AI Agents`,
    text: `${inviter.name} invited you to join ${invitation.organization.name} as ${ROLE_LABELS[role].label}.\n\nAccept the invitation:\n${link}\n\nThis link expires in 7 days.`,
  });
  await writeAudit({ orgId: actor.orgId, actorType: "USER", actorUserId: actor.userId, action: "member.invite", entityType: "Invitation", entityId: invitation.id, metadata: { email, role } });
  // The raw link is returned once so the inviter can copy it when email delivery isn't configured.
  return { invitation, link };
}

export async function revokeInvitation(actor: Actor & { userId: string }, invitationId: string) {
  const inv = await prisma.invitation.findFirst({ where: { id: invitationId, orgId: actor.orgId } });
  if (!inv) throw notFound("Invitation");
  await prisma.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
  await writeAudit({ orgId: actor.orgId, actorType: "USER", actorUserId: actor.userId, action: "member.invite.revoke", entityType: "Invitation", entityId: inv.id });
}

export async function getInvitationByToken(token: string) {
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: sha256(token) },
    include: { organization: { select: { id: true, name: true, deletedAt: true } } },
  });
  if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt.getTime() < Date.now() || inv.organization.deletedAt) return null;
  return inv;
}

/** The signed-in user's email must match the invitation email. */
export async function acceptInvitation(token: string, userId: string, sessionId: string) {
  const inv = await getInvitationByToken(token);
  if (!inv) throw new AppError("VALIDATION", "This invitation is invalid or has expired.");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (normalizeEmail(user.email) !== inv.email) {
    throw new AppError("FORBIDDEN", `This invitation was sent to ${inv.email}. Sign in with that email to accept it.`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.organizationMember.upsert({
      where: { orgId_userId: { orgId: inv.orgId, userId } },
      create: { orgId: inv.orgId, userId, role: inv.role },
      update: {},
    });
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    await tx.session.update({ where: { id: sessionId }, data: { activeOrganizationId: inv.orgId } });
    // An accepted invitation proves ownership of the email address.
    if (!user.emailVerifiedAt) await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  });
  await writeAudit({ orgId: inv.orgId, actorType: "USER", actorUserId: userId, action: "member.join", entityType: "Invitation", entityId: inv.id, metadata: { role: inv.role } });
  await recordActivity({ orgId: inv.orgId, category: "SYSTEM", actorType: "USER", actorUserId: userId, summary: `${user.name} joined the team as ${ROLE_LABELS[inv.role].label}.` });
  return inv.orgId;
}

export async function changeMemberRole(actor: Actor & { userId: string }, memberId: string, role: OrgRole) {
  const member = await prisma.organizationMember.findFirst({ where: { id: memberId, orgId: actor.orgId } });
  if (!member) throw notFound("Member");
  const mine = await actorRole(actor.orgId, actor.userId);
  if (!canAssignRole(mine, role) || !canAssignRole(mine, member.role)) {
    throw new AppError("FORBIDDEN", "You can't change this member's role.");
  }
  if (member.role === "OWNER" && role !== "OWNER") await assertAnotherOwner(actor.orgId, member.id);
  await prisma.organizationMember.update({ where: { id: memberId }, data: { role } });
  await writeAudit({ orgId: actor.orgId, actorType: "USER", actorUserId: actor.userId, action: "member.role.change", entityType: "OrganizationMember", entityId: memberId, metadata: { from: member.role, to: role } });
}

export async function removeMember(actor: Actor & { userId: string }, memberId: string) {
  const member = await prisma.organizationMember.findFirst({ where: { id: memberId, orgId: actor.orgId } });
  if (!member) throw notFound("Member");
  const mine = await actorRole(actor.orgId, actor.userId);
  const self = member.userId === actor.userId;
  if (!self && !canAssignRole(mine, member.role)) throw new AppError("FORBIDDEN", "You can't remove this member.");
  if (member.role === "OWNER") await assertAnotherOwner(actor.orgId, member.id);
  await prisma.$transaction([
    prisma.organizationMember.delete({ where: { id: memberId } }),
    prisma.session.updateMany({ where: { userId: member.userId, activeOrganizationId: actor.orgId }, data: { activeOrganizationId: null } }),
  ]);
  await writeAudit({ orgId: actor.orgId, actorType: "USER", actorUserId: actor.userId, action: self ? "member.leave" : "member.remove", entityType: "OrganizationMember", entityId: memberId });
}

async function assertAnotherOwner(orgId: string, excludingMemberId: string) {
  const owners = await prisma.organizationMember.count({ where: { orgId, role: "OWNER", id: { not: excludingMemberId } } });
  if (owners === 0) throw new AppError("VALIDATION", "A workspace must always have at least one owner.");
}
