import Link from "next/link";
import { Building, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

/** Dashboard ⇄ AI Office toggle (spec §103: the office is an optional visual mode). */
export function ViewSwitch({ current }: { current: "dashboard" | "office" }) {
  const items = [
    { key: "dashboard", href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "office", href: "/office", label: "AI Office", icon: Building },
  ] as const;
  return (
    <nav aria-label="View" className="inline-flex rounded-xl border bg-surface p-1 shadow-card">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={current === i.key ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
            current === i.key ? "bg-brand-soft text-brand-hover" : "text-text-secondary hover:bg-surface-2",
          )}
        >
          <i.icon className="size-4" aria-hidden /> {i.label}
        </Link>
      ))}
    </nav>
  );
}
