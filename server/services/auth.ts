import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { randomToken, sha256 } from "@/lib/security/crypto";
import { hashPassword, passwordProblems, verifyPassword } from "@/lib/security/password";
import { writeAudit } from "@/server/services/audit";
import { sendEmail } from "@/server/services/email";
import { env } from "@/lib/env";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string } = {}) {
  const token = randomToken(32);
  const membership = await prisma.organizationMember.findFirst({
    where: { userId, organization: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
  });
  const session = await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      activeOrganizationId: membership?.orgId ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ipAddress: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300),
    },
  });
  return { token, session };
}

/** Resolves a raw session token to its session + user. Slides expiry once per day. */
export async function validateSessionToken(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.user.deletedAt || session.user.disabledAt) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > SESSION_REFRESH_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }
  return session;
}

export async function revokeSession(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function signUp(input: { name: string; email: string; password: string }) {
  const email = normalizeEmail(input.email);
  const problem = passwordProblems(input.password);
  if (problem) throw new AppError("VALIDATION", problem, { fieldErrors: { password: problem } });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError("CONFLICT", "An account with this email already exists.", {
      fieldErrors: { email: "An account with this email already exists." },
    });
  }
  const user = await prisma.user.create({
    data: { email, name: input.name.trim(), passwordHash: await hashPassword(input.password) },
  });
  await writeAudit({ actorType: "USER", actorUserId: user.id, action: "auth.signup", entityType: "User", entityId: user.id });
  await sendVerificationEmail(user.id, user.email, user.name);
  return user;
}

export async function signIn(input: { email: string; password: string }) {
  const email = normalizeEmail(input.email);
  const user = await prisma.user.findUnique({ where: { email } });
  // Always run a hash comparison to keep timing uniform for unknown emails.
  const ok = user?.passwordHash
    ? await verifyPassword(input.password, user.passwordHash)
    : await verifyPassword(input.password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA");
  if (!user || !ok || user.deletedAt) {
    await writeAudit({ actorType: "USER", actorUserId: user?.id, action: "auth.login", outcome: "DENIED", metadata: { email } });
    throw new AppError("UNAUTHENTICATED", "Incorrect email or password.");
  }
  if (user.disabledAt) {
    await writeAudit({ actorType: "USER", actorUserId: user.id, action: "auth.login", outcome: "DENIED", metadata: { reason: "disabled" } });
    throw new AppError("FORBIDDEN", "This account has been disabled. Contact your administrator.");
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await writeAudit({ actorType: "USER", actorUserId: user.id, action: "auth.login" });
  return user;
}

async function issueToken(userId: string, type: "EMAIL_VERIFICATION" | "PASSWORD_RESET", ttlMs: number) {
  const token = randomToken(32);
  await prisma.verificationToken.updateMany({
    where: { userId, type, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.verificationToken.create({
    data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) },
  });
  return token;
}

export async function sendVerificationEmail(userId: string, email: string, name: string) {
  const token = await issueToken(userId, "EMAIL_VERIFICATION", 48 * 60 * 60 * 1000);
  await sendEmail({
    to: email,
    template: "verification",
    subject: "Verify your email for NBY AI Agents",
    text: `Hi ${name},\n\nConfirm your email address:\n${env().APP_URL}/verify-email?token=${token}\n\nThis link expires in 48 hours.`,
  });
}

export async function verifyEmail(token: string) {
  const record = await consumeToken(token, "EMAIL_VERIFICATION");
  await prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
  return record.userId;
}

async function consumeToken(token: string, type: "EMAIL_VERIFICATION" | "PASSWORD_RESET") {
  const record = await prisma.verificationToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.type !== type || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    throw new AppError("VALIDATION", "This link is invalid or has expired.");
  }
  await prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return record;
}

/** Always resolves (no account enumeration). */
export async function requestPasswordReset(emailInput: string) {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(emailInput) } });
  if (!user || user.deletedAt) return;
  const token = await issueToken(user.id, "PASSWORD_RESET", 60 * 60 * 1000);
  await sendEmail({
    to: user.email,
    template: "password_reset",
    subject: "Reset your NBY AI Agents password",
    text: `Hi ${user.name},\n\nReset your password:\n${env().APP_URL}/reset-password?token=${token}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
  });
  await writeAudit({ actorType: "USER", actorUserId: user.id, action: "auth.password_reset_requested" });
}

export async function resetPassword(token: string, password: string) {
  const problem = passwordProblems(password);
  if (problem) throw new AppError("VALIDATION", problem, { fieldErrors: { password: problem } });
  const record = await consumeToken(token, "PASSWORD_RESET");
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(password) } }),
    // Resetting a password signs the user out everywhere.
    prisma.session.deleteMany({ where: { userId: record.userId } }),
  ]);
  await writeAudit({ actorType: "USER", actorUserId: record.userId, action: "auth.password_reset" });
  return record.userId;
}
