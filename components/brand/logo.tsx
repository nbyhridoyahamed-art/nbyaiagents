import { cn } from "@/lib/utils";

/** NBY mark: three connected nodes — owner, AI workforce, work. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand to-ai text-white shadow-card",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <circle cx="6" cy="7" r="2.2" fill="currentColor" stroke="none" />
        <circle cx="18" cy="7" r="2.2" fill="currentColor" stroke="none" />
        <circle cx="12" cy="17.5" r="2.6" fill="currentColor" stroke="none" />
        <path d="M7.8 8.6 10.6 15M16.2 8.6 13.4 15M8.4 7h7.2" opacity={0.75} />
      </svg>
    </span>
  );
}

export function Logo({ className, collapsed = false }: { className?: string; collapsed?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {!collapsed && (
        <span className="text-[13px] font-bold tracking-[0.08em] text-foreground">
          NBY <span className="text-brand">AI</span> AGENTS
        </span>
      )}
    </span>
  );
}
