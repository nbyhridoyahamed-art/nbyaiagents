import type { Metadata } from "next";
import { requirePageContext } from "@/lib/auth/context";
import { ProfileForms } from "./profile-forms";

export const metadata: Metadata = { title: "Your profile" };

export default async function ProfilePage() {
  const ctx = await requirePageContext();
  return <ProfileForms name={ctx.user.name} email={ctx.user.email} verified={!!ctx.user.emailVerifiedAt} />;
}
