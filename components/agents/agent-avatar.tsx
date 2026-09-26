import { cn } from "@/lib/utils";
import type { AgentStatus } from "@/lib/generated/prisma/enums";
import { STATUS_META } from "@/components/agents/status-meta";

/** Deterministic avatar: initials on the agent's stored colour (never random per render). */
export function AgentAvatar({
  name,
  color,
  size = 44,
  status,
  className,
}: {
  name: string;
  color: string;
  size?: number;
  status?: AgentStatus;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      <span
        className="flex size-full items-center justify-center rounded-full font-semibold text-white"
        style={{
          background: `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 70%, #101828))`,
          fontSize: Math.max(11, Math.round(size * 0.36)),
        }}
        aria-hidden
      >
        {initials}
      </span>
      {status && (
        <span
          className={cn("absolute bottom-0 right-0 size-2.5 rounded-full ring-2 ring-surface", STATUS_META[status].dot)}
          aria-hidden
        />
      )}
    </span>
  );
}
