import { RunStatusBadge } from "@/components/runs/run-status";
import type { Priority, TaskStatus } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return <RunStatusBadge status={status} className={className} />;
}

const PRIORITY: Record<Priority, string> = {
  LOW: "text-text-muted",
  MEDIUM: "text-info-text",
  HIGH: "text-warning-text",
  URGENT: "text-danger-text font-semibold",
};

export function PriorityLabel({ priority }: { priority: Priority }) {
  return <span className={cn("text-xs capitalize", PRIORITY[priority])}>{priority.toLowerCase()}</span>;
}
