"use client";

import Link from "next/link";
import { Menu, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/brand/logo";
import { Breadcrumbs } from "./breadcrumbs";
import { NotificationCenter } from "./notification-center";
import { UserMenu } from "./user-menu";
import { useShell } from "./shell-context";

export function TopHeader({ onOpenSearch, onOpenMenu }: { onOpenSearch: () => void; onOpenMenu: () => void }) {
  const { role } = useShell();
  const canHire = role !== "VIEWER" && role !== "MEMBER";
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b bg-surface/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/80 lg:h-[72px] lg:gap-4 lg:px-8">
      {/* Mobile / tablet: menu + mark */}
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMenu} aria-label="Open navigation">
        <Menu className="size-5" aria-hidden />
      </Button>
      <Link href="/dashboard" className="flex items-center gap-2 lg:hidden" aria-label="Dashboard">
        <LogoMark className="size-7" />
        <span className="font-heading text-sm font-bold tracking-wide">VDO</span>
      </Link>

      <div className="hidden min-w-0 flex-1 lg:block">
        <Breadcrumbs />
      </div>
      <div className="flex-1 lg:hidden" />

      <button
        type="button"
        onClick={onOpenSearch}
        className="hidden h-9 w-64 items-center gap-2 rounded-[10px] border bg-background px-3 text-[13px] text-text-muted transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring md:flex xl:w-80"
        aria-label="Search (Ctrl+K)"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded border bg-surface px-1.5 font-sans text-[11px] font-medium">Ctrl K</kbd>
      </button>
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onOpenSearch} aria-label="Search">
        <Search className="size-[18px]" aria-hidden />
      </Button>

      {canHire && (
        <Button asChild size="lg" className="hidden sm:inline-flex">
          <Link href="/agents/new">
            <Plus aria-hidden /> Hire AI Employee
          </Link>
        </Button>
      )}
      <NotificationCenter />
      <UserMenu />
    </header>
  );
}
