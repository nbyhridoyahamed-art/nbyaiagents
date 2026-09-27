"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { NAV_SECTIONS, isActivePath, type NavItem } from "./nav-config";
import { useShell } from "./shell-context";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { counts } = useShell();
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {NAV_SECTIONS.map((section) => (
        <ul key={section.id} className="grid gap-0.5">
          {section.items.map((item) => (
            <li key={item.href}>
              <NavLink
                item={item}
                active={isActivePath(pathname, item.href)}
                collapsed={collapsed}
                badge={item.badgeKey ? counts[item.badgeKey] : 0}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
      ))}
    </nav>
  );
}

function NavLink({
  item,
  active,
  collapsed,
  badge,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  badge: number;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className={cn("size-[18px] shrink-0", active ? "text-brand-hover" : "text-text-muted group-hover:text-foreground")} aria-hidden />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {badge > 0 &&
        (collapsed ? (
          <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-danger" aria-label={`${badge} pending`} />
        ) : (
          <span className="min-w-5 rounded-full bg-danger px-1.5 text-center text-[11px] font-semibold leading-5 text-white" aria-label={`${badge} pending`}>
            {badge > 99 ? "99+" : badge}
          </span>
        ))}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">
        {item.label}
        {badge > 0 ? ` (${badge})` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden h-dvh flex-col border-r bg-sidebar transition-[width] duration-200 lg:flex",
        collapsed ? "w-[72px]" : "w-[256px]",
      )}
    >
      <div className={cn("flex h-[72px] shrink-0 items-center px-4", collapsed && "justify-center px-0")}>
        <Link href="/dashboard" aria-label="Virtual Desks Online — Dashboard">
          <Logo collapsed={collapsed} />
        </Link>
      </div>
      <div className={cn("px-3 pb-3", collapsed && "px-2.5")}>
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>
      <div className={cn("flex-1 overflow-y-auto px-3 pb-4 pt-1", collapsed && "px-2.5")}>
        <SidebarNav collapsed={collapsed} />
      </div>
      <div className={cn("border-t p-3", collapsed && "px-2.5")}>
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-[13px] text-text-muted hover:bg-sidebar-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
            collapsed && "justify-center px-0",
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <PanelLeftOpen className="size-[18px]" aria-hidden /> : <PanelLeftClose className="size-[18px]" aria-hidden />}
          {!collapsed && "Collapse"}
        </button>
      </div>
    </aside>
  );
}
