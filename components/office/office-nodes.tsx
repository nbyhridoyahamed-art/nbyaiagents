"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Workflow } from "lucide-react";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { STATUS_META } from "@/components/agents/status-meta";
import { DepartmentIcon } from "@/components/departments/department-icon";
import type { AgentStatus, WorkflowStatus } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

const SIDES = [
  { id: "t", position: Position.Top },
  { id: "r", position: Position.Right },
  { id: "b", position: Position.Bottom },
  { id: "l", position: Position.Left },
] as const;

/** Invisible connection points on every side; edges pick the facing sides. */
function Handles() {
  return (
    <>
      {SIDES.map((s) => (
        <Handle key={`s-${s.id}`} id={`s-${s.id}`} type="source" position={s.position} className="!pointer-events-none !size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" isConnectable={false} />
      ))}
      {SIDES.map((s) => (
        <Handle key={`t-${s.id}`} id={`t-${s.id}`} type="target" position={s.position} className="!pointer-events-none !size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" isConnectable={false} />
      ))}
    </>
  );
}

export interface RoomData extends Record<string, unknown> {
  name: string;
  color: string;
  icon: string;
  count: number;
  dimmed: boolean;
}
export type RoomNode = Node<RoomData, "room">;

export const RoomNodeView = memo(function RoomNodeView({ data }: NodeProps<RoomNode>) {
  return (
    <div
      className={cn("size-full rounded-[20px] border-2 border-dashed transition-opacity", data.dimmed && "opacity-40")}
      style={{ borderColor: `color-mix(in oklab, ${data.color} 35%, transparent)`, background: `color-mix(in oklab, ${data.color} 5%, var(--surface))` }}
    >
      <div className="flex items-center gap-2 px-5 pt-3">
        <DepartmentIcon icon={data.icon} color={data.color} size={26} />
        <span className="text-[13px] font-semibold">{data.name}</span>
        <span className="text-xs text-text-muted">
          {data.count} employee{data.count === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
});

export interface EmployeeData extends Record<string, unknown> {
  name: string;
  jobTitle: string;
  color: string;
  status: AgentStatus;
  activity: string | null;
  progress: number | null;
  activeRuns: number;
  draft: boolean;
  dimmed: boolean;
  selected: boolean;
}
export type EmployeeNode = Node<EmployeeData, "employee">;

export const EmployeeNodeView = memo(function EmployeeNodeView({ data }: NodeProps<EmployeeNode>) {
  const meta = STATUS_META[data.status];
  const busy = data.status === "WORKING" || data.activeRuns > 0;
  return (
    <div
      className={cn(
        "relative flex size-full cursor-pointer flex-col rounded-[14px] border bg-surface p-3 shadow-card transition-[opacity,box-shadow,transform] duration-[170ms] hover:-translate-y-px hover:shadow-card-hover",
        data.selected && "ring-2 ring-brand",
        data.dimmed && "opacity-35",
      )}
    >
      {busy && <span aria-hidden className="pointer-events-none absolute -inset-[3px] rounded-[16px] border-2 border-brand/30 animate-pulse-soft" />}
      <Handles />
      <div className="flex items-center gap-2.5">
        <AgentAvatar name={data.name} color={data.color} size={36} status={data.status} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold leading-tight">{data.name}</p>
          <p className="truncate text-[11.5px] text-text-muted">{data.jobTitle}</p>
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium", meta.badge)}>
          <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
          {meta.label}
        </span>
      </div>
      <p className="mt-2 line-clamp-1 text-[12px] text-text-secondary">{data.activity ?? (data.draft ? "Draft — not published yet" : "No active work")}</p>
      {data.progress !== null && (
        <div className="mt-auto h-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-brand" style={{ width: `${data.progress}%` }} />
        </div>
      )}
    </div>
  );
});

export interface WorkflowData extends Record<string, unknown> {
  name: string;
  status: WorkflowStatus;
  activeRuns: number;
  runs30d: number;
  dimmed: boolean;
  selected: boolean;
}
export type WorkflowNode = Node<WorkflowData, "workflow">;

export const WorkflowNodeView = memo(function WorkflowNodeView({ data }: NodeProps<WorkflowNode>) {
  const active = data.status === "ACTIVE";
  return (
    <div
      className={cn(
        "relative flex size-full cursor-pointer items-center gap-2.5 rounded-full border bg-surface px-3 shadow-card transition-opacity",
        data.selected && "ring-2 ring-success",
        data.dimmed && "opacity-35",
      )}
    >
      {data.activeRuns > 0 && <span aria-hidden className="pointer-events-none absolute -inset-[3px] rounded-full border-2 border-success/35 animate-pulse-soft" />}
      <Handles />
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", active ? "bg-success-soft text-success-text" : "bg-surface-2 text-text-muted")}>
        <Workflow className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold">{data.name}</p>
        <p className="truncate text-[11px] text-text-muted">
          {data.activeRuns > 0 ? `${data.activeRuns} running now` : `${data.runs30d} run${data.runs30d === 1 ? "" : "s"} · 30 days`}
          {!active && ` · ${data.status.toLowerCase()}`}
        </p>
      </div>
    </div>
  );
});
