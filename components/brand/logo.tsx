import { cn } from "@/lib/utils";

/** Virtual Desks Online mark: a monitor on a desk, with the "online" status dot. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand to-ai text-white shadow-card",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none">
        <rect x="4" y="5" width="16" height="10.5" rx="2.2" fill="currentColor" />
        <rect x="10" y="16" width="4" height="2.4" fill="currentColor" />
        <rect x="3" y="19" width="18" height="2" rx="1" fill="currentColor" />
      </svg>
      <span className="absolute -right-[3px] -top-[3px] size-[7px] rounded-full bg-ai ring-2 ring-[var(--surface)]" />
    </span>
  );
}

export function Logo({ className, collapsed = false }: { className?: string; collapsed?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {!collapsed && (
        <span className="font-heading text-[13px] font-bold tracking-[0.06em] text-foreground">
          VIRTUAL DESKS <span className="text-brand">ONLINE</span>
        </span>
      )}
    </span>
  );
}
