"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/settings", label: "Company" },
  { href: "/settings/members", label: "Members" },
  { href: "/settings/policies", label: "AI policies" },
  { href: "/settings/providers", label: "AI providers" },
  { href: "/settings/api-keys", label: "API keys" },
  { href: "/settings/audit", label: "Audit log" },
  { href: "/settings/profile", label: "Your profile" },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <ul className="flex gap-1 border-b lg:flex-col lg:gap-0.5 lg:border-0">
        {ITEMS.map((item) => {
          const active = item.href === "/settings" ? pathname === "/settings" : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block whitespace-nowrap px-3 py-2 text-[13.5px] font-medium transition-colors lg:rounded-lg",
                  active
                    ? "border-b-2 border-brand text-brand-hover lg:border-0 lg:bg-brand-soft"
                    : "text-text-secondary hover:text-foreground lg:hover:bg-surface-2",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
