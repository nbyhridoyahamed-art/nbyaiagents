import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { getSession } from "@/lib/auth/context";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : undefined;
  if (await getSession()) redirect(next ?? "/dashboard");
  const notice = sp.reset ? "Password updated. Sign in with your new password." : sp.verified ? "Email verified." : undefined;
  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to your AI company."
      footer={
        <>
          New to Virtual Desks Online?{" "}
          <Link href="/signup" className="font-medium text-brand hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm next={next} notice={notice} />
    </AuthCard>
  );
}
