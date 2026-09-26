import { CheckCircle2, CircleDashed, Clock, Hand, Loader2, OctagonX, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "QUEUED" | "RUNNING" | "WAITING" | "AWAITING_APPROVAL" | "COMPLETED" | "FAILED" | "CANCELLED";

const META: Record<Status, { label: string; className: string; Icon: typeof CheckCircle2; spin?: boolean }> = {
  QUEUED: { label: "Queued", className: "bg-surface-2 text-text-secondary", Icon: Clock },
  RUNNING: { label: "Running", className: "bg-brand-soft text-brand-hover", Icon: Loader2, spin: true },
  WAITING: { label: "Waiting", className: "bg-info-soft text-info-text", Icon: CircleDashed },
  AWAITING_APPROVAL: { label: "Awaiting approval", className: "bg-warning-soft text-warning-text", Icon: Hand },
  COMPLETED: { label: "Completed", className: "bg-success-soft text-success-text", Icon: CheckCircle2 },
  FAILED: { label: "Failed", className: "bg-danger-soft text-danger-text", Icon: XCircle },
  CANCELLED: { label: "Cancelled", className: "bg-surface-2 text-text-muted", Icon: OctagonX },
};

export function RunStatusBadge({ status, className }: { status: Status; className?: string }) {
  const m = META[status];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium", m.className, className)}>
      <m.Icon className={cn("size-3", m.spin && "animate-spin motion-reduce:animate-none")} aria-hidden />
      {m.label}
    </span>
  );
}
