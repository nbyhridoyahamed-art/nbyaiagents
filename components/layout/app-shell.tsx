"use client";

import { useState, type ReactNode } from "react";
import { useLocalStorage } from "@/hooks/use-browser";
import { cn } from "@/lib/utils";
import { Sidebar } from "./sidebar";
import { TopHeader } from "./top-header";
import { BottomNav, MobileDrawer } from "./mobile-nav";
import { CommandPalette } from "./command-palette";
import { AskDesks } from "./ask-desks";
import { roleHas } from "@/lib/permissions/rbac";
import { ShellProvider, type ShellData } from "./shell-context";
import { BreadcrumbProvider } from "./breadcrumbs";

const COLLAPSE_KEY = "vdo-sidebar-collapsed";

export function AppShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const [collapsedFlag, setCollapsedFlag] = useLocalStorage(COLLAPSE_KEY, "0");
  const collapsed = collapsedFlag === "1";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  function toggle() {
    setCollapsedFlag(collapsed ? "0" : "1");
  }

  return (
    <ShellProvider value={data}>
      <BreadcrumbProvider>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop"
        >
          Skip to content
        </a>
        <Sidebar collapsed={collapsed} onToggle={toggle} />
        <MobileDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
        <div className={cn("flex min-h-dvh flex-col transition-[padding] duration-200", collapsed ? "lg:pl-[72px]" : "lg:pl-[256px]")}>
          <TopHeader onOpenSearch={() => setPaletteOpen(true)} onOpenMenu={() => setDrawerOpen(true)} />
          <main id="main" className="flex-1 pb-24 md:pb-12">
            {children}
          </main>
        </div>
        <BottomNav onMore={() => setDrawerOpen(true)} />
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        <AskDesks canHire={roleHas(data.role, "agents:write")} canBuild={roleHas(data.role, "workflows:write")} />
      </BreadcrumbProvider>
    </ShellProvider>
  );
}
