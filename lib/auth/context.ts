import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { clientIp } from "@/lib/security/client-ip";
import { AppError } from "@/lib/errors";
import { roleHas, type Permission } from "@/lib/permissions/rbac";
import { SESSION_TTL_MS, validateSessionToken } from "@/server/services/auth";
import type { OrgRole } from "@/lib/generated/prisma/enums";

export const SESSION_COOKIE = "nby_session";

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Secure whenever the app is served over https (not merely "production": local builds run on http).
    secure: env().APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function requestMeta() {
  const h = await headers();
  return {
    ip: clientIp(h),
    userAgent: h.get("user-agent") ?? undefined,
  };
}

/** Current session (deduplicated per request). */
export const getSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSessionToken(token);
});

export interface OrgContext {
  user: { id: string; email: string; name: string; platformRole: "USER" | "SUPER_ADMIN"; emailVerifiedAt: Date | null };
  sessionId: string;
  org: { id: string; name: string; slug: string; timezone: string; onboardingCompletedAt: Date | null; plan: string; isDemo: boolean; suspended: boolean };
  role: OrgRole;
  can: (permission: Permission) => boolean;
}

/**
 * Resolves the signed-in user and their *active* organization membership.
 * The org is always derived from the server-side session + membership table —
 * never from an ID supplied by the browser.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const session = await getSession();
  if (!session) return null;

  let membership = session.activeOrganizationId
    ? await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId: session.activeOrganizationId, userId: session.userId } },
        include: { organization: true },
      })
    : null;

  if (!membership || membership.organization.deletedAt) {
    membership = await prisma.organizationMember.findFirst({
      where: { userId: session.userId, organization: { deletedAt: null } },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    });
    if (membership) {
      await prisma.session.update({ where: { id: session.id }, data: { activeOrganizationId: membership.orgId } });
    }
  }
  if (!membership) return null;

  const role = membership.role;
  const { user } = session;
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      platformRole: user.platformRole,
      emailVerifiedAt: user.emailVerifiedAt,
    },
    sessionId: session.id,
    org: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      timezone: membership.organization.timezone,
      onboardingCompletedAt: membership.organization.onboardingCompletedAt,
      plan: membership.organization.plan,
      isDemo: membership.organization.isDemo,
      suspended: !!membership.organization.suspendedAt,
    },
    role,
    can: (permission) => roleHas(role, permission),
  };
});

/** For pages: redirects to login / company setup when needed. */
export async function requirePageContext(permission?: Permission): Promise<OrgContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  const ctx = await getOrgContext();
  if (!ctx) redirect("/onboarding");
  if (ctx.org.suspended) redirect("/suspended");
  if (permission && !ctx.can(permission)) redirect("/dashboard?denied=1");
  return ctx;
}

/** For server actions / route handlers: throws AppError instead of redirecting. */
export async function requireOrgContext(permission?: Permission): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
  if (ctx.org.suspended) throw new AppError("FORBIDDEN", "This company workspace is suspended. Contact support.");
  if (permission && !ctx.can(permission)) {
    throw new AppError("FORBIDDEN", "Your role doesn't allow this action. Ask an admin for access.");
  }
  return ctx;
}
