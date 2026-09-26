import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, XCircle } from "lucide-react";
import { AuthCard } from "@/components/auth/auth-card";
import { verifyEmail } from "@/server/services/auth";
import { isAppError } from "@/lib/errors";

export const metadata: Metadata = { title: "Verify email" };

export default async function VerifyEmailPage(props: PageProps<"/verify-email">) {
  const { token } = await props.searchParams;
  let error: string | null = null;
  if (typeof token !== "string") error = "This verification link is incomplete.";
  else {
    try {
      await verifyEmail(token);
    } catch (err) {
      error = isAppError(err) ? err.message : "We couldn't verify your email.";
    }
  }
  return (
    <AuthCard title={error ? "Verification failed" : "Email verified"}>
      <div className="flex items-start gap-3">
        {error ? (
          <XCircle className="mt-0.5 size-5 text-danger" aria-hidden />
        ) : (
          <CheckCircle2 className="mt-0.5 size-5 text-success" aria-hidden />
        )}
        <p className="text-text-secondary">
          {error ?? "Thanks — your email address is confirmed."}{" "}
          <Link href="/dashboard" className="font-medium text-brand hover:underline">
            Continue
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}
