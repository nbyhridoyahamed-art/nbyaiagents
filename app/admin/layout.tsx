import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Shield } from "lucide-react";
import { requirePlatformAdminPage } from "@/lib/auth/admin";
import { AdminNav } from "./admin-nav";

export const metadata: Metadata = { title: { default: "Platform admin", template: "%s · Platform admin" }, robots: { index: false } };

/** Platform admin area — separate from any company workspace (spec §122). */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requirePlatformAdminPage();
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b bg-surface">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3 lg:px-8">
          <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
            <Shield className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-heading text-[14px] font-semibold">Virtual Desks Online admin</p>
            <p className="text-xs text-text-muted">Signed in as {admin.email} · actions here are audited</p>
          </div>
          <Link href="/dashboard" className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
            <ArrowLeft className="size-4" aria-hidden /> Back to workspace
          </Link>
        </div>
        <div className="mx-auto max-w-[1600px] px-4 pb-2 lg:px-8">
          <AdminNav />
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-6 lg:px-8">{children}</main>
    </div>
  );
}
