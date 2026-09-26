"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Copy, Loader2, Mail, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/forms/field";
import { ConfirmButton } from "@/components/common/confirm-button";
import { useAction } from "@/hooks/use-action";
import { canAssignRole, ROLE_LABELS } from "@/lib/permissions/rbac";
import type { OrgRole } from "@/lib/generated/prisma/enums";
import { changeRoleAction, inviteMemberAction, removeMemberAction, revokeInvitationAction } from "../actions";

const ROLES: OrgRole[] = ["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"];

interface MemberRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  lastLoginAt: string | null;
  verified: boolean;
}

export function MembersView({
  members,
  invitations,
  currentUserId,
  currentRole,
  canManage,
}: {
  members: MemberRow[];
  invitations: { id: string; email: string; role: OrgRole; expiresAt: string }[];
  currentUserId: string;
  currentRole: OrgRole;
  canManage: boolean;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("MEMBER");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const invite = useAction(inviteMemberAction, {
    success: "Invitation created.",
    onSuccess: (data) => {
      setInviteLink(data.link);
      setEmail("");
    },
  });
  const changeRole = useAction(changeRoleAction, { success: "Role updated." });
  const remove = useAction(removeMemberAction, { success: "Member removed." });
  const revoke = useAction(revokeInvitationAction, { success: "Invitation revoked." });
  const assignable = ROLES.filter((r) => canAssignRole(currentRole, r));

  return (
    <div className="grid gap-6">
      {canManage && (
        <section className="rounded-xl border bg-surface p-5 shadow-card sm:p-6">
          <h2 className="text-card-title">Invite a teammate</h2>
          <p className="text-[13px] text-text-secondary">Teammates supervise your AI workforce with the permissions of their role.</p>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              setInviteLink(null);
              void invite.run({ email, role });
            }}
          >
            <Field label="Email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={invite.fieldErrors.email} placeholder="name@company.com" />
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">Role</span>
              <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
                <SelectTrigger className="h-10 w-full" aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assignable.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" size="lg" disabled={invite.pending || !email}>
              {invite.pending ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
              Send invite
            </Button>
          </form>
          <p className="mt-2 text-xs text-text-muted">{ROLE_LABELS[role].description}</p>
          {inviteLink && (
            <div className="mt-4 rounded-lg border border-info/30 bg-info-soft p-3 text-[13px] text-info-text">
              <p className="font-medium">Invitation created.</p>
              <p className="mt-0.5">
                If email delivery isn&apos;t configured yet, share this one-time link directly (expires in 7 days):
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-xs text-foreground">{inviteLink}</code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(inviteLink);
                    toast.success("Link copied");
                  }}
                >
                  <Copy aria-hidden /> Copy
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="rounded-xl border bg-surface shadow-card">
        <div className="border-b px-5 py-4">
          <h2 className="text-card-title">Team members</h2>
          <p className="text-[13px] text-text-secondary">{members.length} member{members.length === 1 ? "" : "s"}</p>
        </div>
        <ul className="divide-y">
          {members.map((m) => {
            const self = m.userId === currentUserId;
            const editable = canManage && !self && canAssignRole(currentRole, m.role);
            return (
              <li key={m.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold">
                    {m.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((w) => w[0]?.toUpperCase())
                      .join("")}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium">
                      {m.name} {self && <span className="text-text-muted">(you)</span>}
                    </p>
                    <p className="truncate text-xs text-text-muted">
                      {m.email}
                      {m.lastLoginAt ? ` · active ${formatDistanceToNow(new Date(m.lastLoginAt), { addSuffix: true })}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {editable ? (
                    <Select value={m.role} onValueChange={(v) => void changeRole.run({ memberId: m.id, role: v })} disabled={changeRole.pending}>
                      <SelectTrigger className="h-9 w-36" aria-label={`Role for ${m.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {assignable.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABELS[r].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="secondary">{ROLE_LABELS[m.role].label}</Badge>
                  )}
                  {(editable || self) && (
                    <ConfirmButton
                      size="sm"
                      variant="ghost"
                      destructive
                      title={self ? "Leave this workspace?" : `Remove ${m.name}?`}
                      description={self ? "You'll lose access until someone invites you again." : `${m.name} will immediately lose access to this workspace.`}
                      confirmLabel={self ? "Leave" : "Remove"}
                      onConfirm={() => remove.run(m.id)}
                    >
                      {self ? "Leave" : "Remove"}
                    </ConfirmButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {invitations.length > 0 && (
        <section className="rounded-xl border bg-surface shadow-card">
          <div className="border-b px-5 py-4">
            <h2 className="text-card-title">Pending invitations</h2>
          </div>
          <ul className="divide-y">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-5 py-3.5">
                <Mail className="size-4 text-text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px]">{i.email}</p>
                  <p className="text-xs text-text-muted">
                    {ROLE_LABELS[i.role].label} · expires {formatDistanceToNow(new Date(i.expiresAt), { addSuffix: true })}
                  </p>
                </div>
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={() => void revoke.run(i.id)} disabled={revoke.pending}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
