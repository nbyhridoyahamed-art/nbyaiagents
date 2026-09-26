"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/context";
import { acceptInvitation } from "@/server/services/members";

export async function acceptInvitationAction(token: string) {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  await acceptInvitation(String(token), session.userId, session.id);
  redirect("/dashboard");
}
