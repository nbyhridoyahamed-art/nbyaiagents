import Link from "next/link";
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const { token } = await props.searchParams;
  if (typeof token !== "string" || !token) {
    return (
      <AuthCard title="Link missing" subtitle="This reset link is incomplete. Request a new one.">
        <Link href="/forgot-password" className="font-medium text-brand hover:underline">
          Request a new link
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password" subtitle="You'll be signed out of all other devices.">
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
