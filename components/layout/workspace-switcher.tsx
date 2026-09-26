"use client";

import { useTransition } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";
import { switchOrganizationAction } from "@/app/(app)/shell-actions";

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function WorkspaceSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { org, organizations } = useShell();
  const [pending, start] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-[10px] border bg-surface px-2.5 py-2 text-left transition-colors hover:bg-sidebar-hover focus-visible:outline-2 focus-visible:outline-ring",
          collapsed && "justify-center px-0",
        )}
        aria-label={`Workspace: ${org.name}. Switch workspace`}
        disabled={pending}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-soft text-[11px] font-bold text-brand-hover">
          {initials(org.name)}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-foreground">{org.name}</span>
              <span className="block text-[11px] capitalize text-text-muted">{org.plan.toLowerCase()} plan</span>
            </span>
            <ChevronsUpDown className="size-4 text-text-muted" aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs text-text-muted">Workspaces</DropdownMenuLabel>
        {organizations.map((o) => (
          <DropdownMenuItem
            key={o.id}
            onSelect={() => o.id !== org.id && start(() => switchOrganizationAction(o.id))}
            className="gap-2"
          >
            <span className="flex size-6 items-center justify-center rounded bg-surface-2 text-[10px] font-bold">{initials(o.name)}</span>
            <span className="flex-1 truncate">{o.name}</span>
            {o.id === org.id && <Check className="size-4 text-brand" aria-hidden />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/onboarding/new-company" className="gap-2">
            <Plus className="size-4" aria-hidden /> New workspace
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
