import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page-load entrance (spec §97): opacity 0→1, y 8→0, 300ms, 40ms stagger.
 * Pure CSS so content never depends on JavaScript (or a foreground tab) to become
 * visible; `prefers-reduced-motion` disables it globally in globals.css.
 */
export function Reveal({ children, index = 0, className }: { children: ReactNode; index?: number; className?: string }) {
  return (
    <div className={cn("animate-rise", className)} style={{ animationDelay: `${index * 40}ms` }}>
      {children}
    </div>
  );
}
