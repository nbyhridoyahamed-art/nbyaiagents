import type { Metadata } from "next";
import { requirePageContext } from "@/lib/auth/context";
import { listMembers } from "@/server/services/members";
import { MembersView } from "./members-view";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage() {
  const ctx = await requirePageContext("members:read");
  const { members, invitations } = await listMembers(ctx.org.id);
  return (
    <MembersView
      currentUserId={ctx.user.id}
      currentRole={ctx.role}
      canManage={ctx.can("members:manage")}
      members={members.map((m) => ({
        id: m.id,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
        verified: !!m.user.emailVerifiedAt,
      }))}
      invitations={invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() }))}
    />
  );
}
