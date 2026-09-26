import { cn } from "@/lib/utils";
import type { AgentStatus } from "@/lib/generated/prisma/enums";
import { STATUS_META } from "./status-meta";

/** Status pill: coloured dot + text label (never colour alone). */
export function AgentStatusBadge({ status, className }: { status: AgentStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium", meta.badge, className)}>
      <span className={cn("size-1.5 rounded-full", meta.dot, meta.pulse && "animate-pulse-soft")} aria-hidden />
      {meta.label}
    </span>
  );
}
