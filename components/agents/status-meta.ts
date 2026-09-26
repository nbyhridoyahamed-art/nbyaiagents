import type { AgentStatus } from "@/lib/generated/prisma/enums";

/** Status is always shown as icon/dot + text, never colour alone. */
export const STATUS_META: Record<AgentStatus, { label: string; dot: string; badge: string; pulse?: boolean }> = {
  WORKING: { label: "Working", dot: "bg-brand", badge: "bg-brand-soft text-brand-hover", pulse: true },
  ACTIVE: { label: "Active", dot: "bg-success", badge: "bg-success-soft text-success-text" },
  WAITING: { label: "Waiting", dot: "bg-info", badge: "bg-info-soft text-info-text" },
  APPROVAL: { label: "Approval", dot: "bg-warning", badge: "bg-warning-soft text-warning-text", pulse: true },
  ERROR: { label: "Error", dot: "bg-danger", badge: "bg-danger-soft text-danger-text" },
  PAUSED: { label: "Paused", dot: "bg-text-muted", badge: "bg-surface-2 text-text-secondary" },
  SCHEDULED: { label: "Scheduled", dot: "bg-ai", badge: "bg-ai-soft text-ai" },
};
