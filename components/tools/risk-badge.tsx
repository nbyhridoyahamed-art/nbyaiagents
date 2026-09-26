import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/lib/generated/prisma/enums";

const STYLES: Record<RiskLevel, string> = {
  LOW: "bg-success-soft text-success-text",
  MEDIUM: "bg-info-soft text-info-text",
  HIGH: "bg-warning-soft text-warning-text",
  CRITICAL: "bg-danger-soft text-danger-text",
};

export function RiskBadge({ risk, className }: { risk: RiskLevel; className?: string }) {
  return (
    <span className={cn("inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold", STYLES[risk], className)}>
      {risk.charAt(0) + risk.slice(1).toLowerCase()} risk
    </span>
  );
}

export function SimulatedBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex rounded-md bg-ai-soft px-1.5 py-0.5 text-[11px] font-semibold text-ai", className)} title="This integration is simulated. Nothing leaves the platform.">
      Simulated
    </span>
  );
}
