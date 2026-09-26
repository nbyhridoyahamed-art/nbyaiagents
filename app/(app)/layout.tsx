import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { listUserOrganizations } from "@/server/services/organizations";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requirePageContext();
  if (!ctx.org.onboardingCompletedAt) redirect("/onboarding/team");

  const [memberships, approvals, questions, notifications] = await Promise.all([
    listUserOrganizations(ctx.user.id),
    prisma.approval.count({ where: { orgId: ctx.org.id, status: "PENDING", kind: { in: ["TOOL_ACTION", "REVIEW"] } } }),
    prisma.approval.count({ where: { orgId: ctx.org.id, status: "PENDING", kind: { in: ["QUESTION", "INPUT_REQUEST", "ESCALATION"] } } }),
    prisma.notification.count({ where: { orgId: ctx.org.id, userId: ctx.user.id, readAt: null } }),
  ]);

  return (
    <AppShell
      data={{
        user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, isPlatformAdmin: ctx.user.platformRole === "SUPER_ADMIN" },
        org: { id: ctx.org.id, name: ctx.org.name, plan: ctx.org.plan },
        role: ctx.role,
        organizations: memberships.map((m) => ({ id: m.organization.id, name: m.organization.name })),
        counts: { approvals, inbox: questions, notifications },
      }}
    >
      {children}
    </AppShell>
  );
}
