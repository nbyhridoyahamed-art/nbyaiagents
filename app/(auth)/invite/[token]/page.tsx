import Link from "next/link";
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/context";
import { ROLE_LABELS } from "@/lib/permissions/rbac";
import { getInvitationByToken } from "@/server/services/members";
import { acceptInvitationAction } from "./actions";

export const metadata: Metadata = { title: "Join workspace" };

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;
  const invitation = await getInvitationByToken(token);
  if (!invitation) {
    return (
      <AuthCard title="Invitation unavailable" subtitle="This invitation is invalid, was revoked, or has expired. Ask your admin for a new one." />
    );
  }
  const session = await getSession();
  const next = `/invite/${token}`;
  return (
    <AuthCard
      title={`Join ${invitation.organization.name}`}
      subtitle={
        <>
          You&apos;ve been invited as <strong className="font-medium text-foreground">{ROLE_LABELS[invitation.role].label}</strong> to help
          supervise their AI workforce.
        </>
      }
    >
      {session ? (
        <form action={acceptInvitationAction.bind(null, token)} className="grid gap-3">
          <p className="text-[13px] text-text-secondary">
            Signed in as <span className="font-medium text-foreground">{session.user.email}</span>.
            {session.user.email !== invitation.email && (
              <span className="mt-1 block text-warning-text">This invitation was sent to {invitation.email}. Sign in with that email to accept.</span>
            )}
          </p>
          <Button type="submit" size="lg" disabled={session.user.email !== invitation.email}>
            Accept invitation
          </Button>
        </form>
      ) : (
        <div className="grid gap-2">
          <Button asChild size="lg">
            <Link href={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={`/login?next=${encodeURIComponent(next)}`}>I already have an account</Link>
          </Button>
          <p className="text-center text-xs text-text-muted">Use {invitation.email} so we can match your invitation.</p>
        </div>
      )}
    </AuthCard>
  );
}
