"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Building, CheckCircle2, FileText, ListChecks, MessagesSquare, Play, Plug, Settings, Sparkles, UserPlus, Users, Workflow, Wrench } from "lucide-react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { globalSearchAction, type SearchResult } from "@/app/(app)/shell-actions";
import { NAV_SECTIONS } from "./nav-config";
import { ASK_EVENT } from "./ask-nby";

const ACTIONS: { label: string; href: string; icon: typeof Users }[] = [
  { label: "Ask NBY AI", href: "#ask", icon: Sparkles },
  { label: "Create AI Employee", href: "/agents/new", icon: UserPlus },
  { label: "Create Workflow", href: "/workflows/new", icon: Workflow },
  { label: "Run Workflow", href: "/workflows?run=1", icon: Play },
  { label: "Open Approvals", href: "/approvals", icon: CheckCircle2 },
  { label: "Search Knowledge", href: "/knowledge?search=1", icon: BookOpen },
  { label: "Connect Tool", href: "/integrations", icon: Plug },
  { label: "Open Settings", href: "/settings", icon: Settings },
  { label: "Open AI Office", href: "/office", icon: Building },
];

const GROUP_ICONS: Record<SearchResult["group"], typeof Users> = {
  Agents: Users,
  Tasks: ListChecks,
  Workflows: Workflow,
  Knowledge: FileText,
  Tools: Wrench,
  Conversations: MessagesSquare,
};

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [, startSearch] = useTransition();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const handle = setTimeout(() => {
      startSearch(async () => setResults(await globalSearchAction(query)));
    }, 180);
    return () => clearTimeout(handle);
  }, [query]);

  function go(href: string) {
    onOpenChange(false);
    setQuery("");
    if (href === "#ask") {
      window.dispatchEvent(new Event(ASK_EVENT));
      return;
    }
    router.push(href);
  }

  const visibleResults = query.trim().length >= 2 ? results : [];
  const groups = visibleResults.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.group] ??= []).push(r);
    return acc;
  }, {});

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search and commands" description="Search your AI company or run a command">
      {/* shadcn's CommandDialog doesn't provide the cmdk root; without it the input has no store. */}
      <Command>
        <CommandInput placeholder="Search employees, tasks, workflows, knowledge…" value={query} onValueChange={setQuery} />
        <CommandList className="max-h-[420px]">
          <CommandEmpty>No results found.</CommandEmpty>
          {Object.entries(groups).map(([group, items]) => {
            const Icon = GROUP_ICONS[group as SearchResult["group"]];
            return (
              <CommandGroup key={group} heading={group}>
                {items.map((r) => (
                  <CommandItem key={`${group}-${r.id}`} value={`${group} ${r.title} ${r.id}`} onSelect={() => go(r.href)}>
                    <Icon aria-hidden />
                    <span className="truncate">{r.title}</span>
                    {r.subtitle && <span className="ml-auto truncate text-xs capitalize text-text-muted">{r.subtitle}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
          <CommandGroup heading="Actions">
            {ACTIONS.map((a) => (
              <CommandItem key={a.href} value={a.label} onSelect={() => go(a.href)}>
                <a.icon aria-hidden />
                {a.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Go to">
            {NAV_SECTIONS.flatMap((s) => s.items).map((item) => (
              <CommandItem key={item.href} value={`Go to ${item.label}`} onSelect={() => go(item.href)}>
                <item.icon aria-hidden />
                {item.label}
                <CommandShortcut>↵</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
