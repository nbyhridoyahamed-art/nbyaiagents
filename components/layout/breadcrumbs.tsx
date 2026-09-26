"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { SEGMENT_LABELS } from "./nav-config";

type Overrides = Record<string, string>;
const BreadcrumbContext = createContext<{ overrides: Overrides; set: (segment: string, label: string | null) => void } | null>(null);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Overrides>({});
  // Stable setter: consumers list it as an effect dependency, so it must never change identity.
  const set = useCallback(
    (segment: string, label: string | null) =>
      setOverrides((prev) => {
        if (label === null) {
          if (!(segment in prev)) return prev;
          const next = { ...prev };
          delete next[segment];
          return next;
        }
        return prev[segment] === label ? prev : { ...prev, [segment]: label };
      }),
    [],
  );
  const value = useMemo(() => ({ overrides, set }), [overrides, set]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

/** Lets a page give a dynamic segment (e.g. an agent ID) a readable breadcrumb label. */
export function BreadcrumbLabel({ segment, label }: { segment: string; label: string }) {
  const ctx = useContext(BreadcrumbContext);
  const set = ctx?.set;
  useEffect(() => {
    set?.(segment, label);
    return () => set?.(segment, null);
  }, [segment, label, set]);
  return null;
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const ctx = useContext(BreadcrumbContext);
  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.map((seg, i) => ({
    href: "/" + segments.slice(0, i + 1).join("/"),
    label:
      ctx?.overrides[seg] ??
      // "new" means hiring only under employees; elsewhere it's creating something.
      (seg === "new" && segments[i - 1] !== "agents" ? "New" : undefined) ??
      SEGMENT_LABELS[seg] ??
      (seg.includes("_") ? "Details" : seg.replace(/-/g, " ")),
  }));
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-[13px]">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.href} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-text-muted" aria-hidden />}
              {last ? (
                <span aria-current="page" className="truncate font-medium capitalize text-foreground">
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="truncate capitalize text-text-muted hover:text-foreground">
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
