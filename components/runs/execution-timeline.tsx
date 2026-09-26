import { Check, Circle, Hand, Loader2, ShieldX, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TimelineStep {
  id: string;
  label: string;
  status: string;
  summary?: string | null;
  error?: string | null;
}

/**
 * Operational execution timeline (spec §17, §88): what the employee *did* —
 * never hidden model reasoning.
 */
export function ExecutionTimeline({ steps, pendingLabel, className }: { steps: TimelineStep[]; pendingLabel?: string; className?: string }) {
  const items = pendingLabel ? [...steps, { id: "pending", label: pendingLabel, status: "PENDING" }] : steps;
  return (
    <ol className={cn("relative grid gap-0", className)} aria-label="Execution steps">
      {items.map((s, i) => {
        const last = i === items.length - 1;
        return (
          <li key={s.id} className="relative flex gap-3 pb-3 last:pb-0">
            {!last && <span className="absolute left-[9px] top-5 h-[calc(100%-12px)] w-px bg-border" aria-hidden />}
            <StepIcon status={s.status} />
            <div className="min-w-0 pt-px">
              <p className={cn("text-[13px]", s.status === "PENDING" ? "text-text-muted" : "text-foreground")}>
                {s.label}
                <span className="sr-only"> — {s.status.toLowerCase().replace("_", " ")}</span>
              </p>
              {s.summary && <p className="text-xs text-text-muted">{s.summary}</p>}
              {s.error && <p className="text-xs text-danger-text">{s.error}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepIcon({ status }: { status: string }) {
  const base = "relative z-[1] mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full";
  switch (status) {
    case "SUCCEEDED":
      return (
        <span className={cn(base, "bg-success text-white")}>
          <Check className="size-3" strokeWidth={3} aria-hidden />
        </span>
      );
    case "RUNNING":
      return (
        <span className={cn(base, "bg-brand-soft text-brand animate-pulse-soft")}>
          <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
        </span>
      );
    case "AWAITING_APPROVAL":
    case "WAITING":
      return (
        <span className={cn(base, "bg-warning-soft text-warning-text")}>
          <Hand className="size-3" aria-hidden />
        </span>
      );
    case "DENIED":
      return (
        <span className={cn(base, "bg-danger-soft text-danger-text")}>
          <ShieldX className="size-3" aria-hidden />
        </span>
      );
    case "FAILED":
    case "CANCELLED":
      return (
        <span className={cn(base, "bg-danger text-white")}>
          <X className="size-3" strokeWidth={3} aria-hidden />
        </span>
      );
    default:
      return (
        <span className={cn(base, "border border-border-strong bg-surface text-text-muted")}>
          <Circle className="size-1.5 fill-current" aria-hidden />
        </span>
      );
  }
}
