import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { getSession } from "@/lib/auth/context";
import { SignUpForm } from "./signup-form";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage(props: PageProps<"/signup">) {
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  if (await getSession()) redirect(next?.startsWith("/invite/") ? next : "/dashboard");
  return (
    <AuthCard
      title="Build your AI workforce"
      subtitle="Create AI employees, give them knowledge, connect their tools and automate real work."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm next={next} />
    </AuthCard>
  );
}
