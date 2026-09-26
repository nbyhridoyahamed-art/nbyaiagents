import type { WorkflowStatus } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

const META: Record<WorkflowStatus, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-surface-2 text-text-secondary" },
  ACTIVE: { label: "Active", className: "bg-success-soft text-success-text" },
  PAUSED: { label: "Paused", className: "bg-warning-soft text-warning-text" },
  ARCHIVED: { label: "Archived", className: "bg-surface-2 text-text-muted" },
};

export function WorkflowStatusBadge({ status, className }: { status: WorkflowStatus; className?: string }) {
  const m = META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium", m.className, className)}>
      <span className={cn("size-1.5 rounded-full", status === "ACTIVE" ? "bg-success" : status === "PAUSED" ? "bg-warning" : "bg-text-muted")} aria-hidden />
      {m.label}
    </span>
  );
}
