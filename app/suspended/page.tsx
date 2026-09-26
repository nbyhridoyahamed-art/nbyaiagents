import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldOff } from "lucide-react";
import { getOrgContext, getSession } from "@/lib/auth/context";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = { title: "Workspace suspended" };

export default async function SuspendedPage() {
  if (!(await getSession())) redirect("/login");
  const ctx = await getOrgContext();
  if (ctx && !ctx.org.suspended) redirect("/dashboard");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-warning-soft text-warning-text">
        <ShieldOff className="size-6" aria-hidden />
      </span>
      <h1 className="mt-5 text-section-title">{ctx ? `${ctx.org.name} is suspended` : "Workspace suspended"}</h1>
      <p className="mt-2 text-text-secondary">
        A platform administrator has paused this workspace. Your data is safe, but employees and workflows won&apos;t run until it&apos;s reactivated. Contact support for help.
      </p>
      <div className="mt-6">
        <SignOutButton />
      </div>
    </main>
  );
}
