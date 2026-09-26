"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AlertCircle, Check, Hand, Loader2, X } from "lucide-react";
import { nodeMeta, type NodeType } from "@/lib/workflows/types";
import { handlesFor } from "@/lib/workflows/validate-graph";
import { cn } from "@/lib/utils";
import { CATEGORY_STYLES, NODE_ICONS } from "./node-visuals";

export interface FlowNodeData extends Record<string, unknown> {
  type: NodeType;
  label: string;
  config: Record<string, unknown>;
  summary?: string;
  issue?: "error" | "warning";
  runStatus?: string;
}

export type FlowNode = Node<FlowNodeData, "step">;

const HANDLE_LABELS: Record<string, string> = { out: "", true: "Yes", false: "No", approved: "Approved", rejected: "Rejected", each: "Each", done: "Done", error: "On error", default: "Default" };

function RunStatus({ status }: { status: string }) {
  if (status === "COMPLETED" || status === "SUCCEEDED") return <Check className="size-3.5 text-success" aria-label="Completed" />;
  if (status === "FAILED" || status === "DENIED") return <X className="size-3.5 text-danger" aria-label="Failed" />;
  if (status === "RUNNING") return <Loader2 className="size-3.5 animate-spin text-brand" aria-label="Running" />;
  if (status === "WAITING" || status === "AWAITING_APPROVAL") return <Hand className="size-3.5 text-warning" aria-label="Waiting" />;
  if (status === "SKIPPED") return <span className="text-[10px] font-medium text-text-muted">skipped</span>;
  return null;
}

/** A workflow step on the canvas: icon, label, one input and its named outputs. */
export const FlowNodeView = memo(function FlowNodeView({ data, selected }: NodeProps<FlowNode>) {
  const meta = nodeMeta(data.type);
  if (!meta) return null;
  const style = CATEGORY_STYLES[meta.category];
  const Icon = NODE_ICONS[meta.icon];
  const handles = handlesFor({ key: "", type: data.type, label: data.label, config: data.config, position: { x: 0, y: 0 } });
  const isTrigger = data.type.startsWith("trigger.");
  const skipped = data.runStatus === "SKIPPED";

  return (
    <div
      className={cn(
        "relative w-[228px] rounded-xl border bg-surface shadow-card transition-shadow",
        selected && "ring-2 ring-brand",
        data.issue === "error" && "border-danger/60",
        data.issue === "warning" && "border-warning/60",
        skipped && "opacity-50",
      )}
    >
      {!isTrigger && <Handle type="target" position={Position.Left} className="!size-3 !border-2 !border-surface !bg-border-strong" />}
      <div className="flex items-start gap-2.5 p-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ background: style.soft, color: style.accent }}>
          {Icon && <Icon className="size-4" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: style.accent }}>
            {meta.label}
          </p>
          <p className="truncate text-[13px] font-semibold text-foreground">{data.label}</p>
          {data.summary && <p className="mt-0.5 line-clamp-2 text-[11px] text-text-muted">{data.summary}</p>}
        </div>
        <div className="flex flex-col items-end gap-1">
          {data.issue && <AlertCircle className={cn("size-3.5", data.issue === "error" ? "text-danger" : "text-warning")} aria-label={data.issue === "error" ? "Has errors" : "Has warnings"} />}
          {data.runStatus && <RunStatus status={data.runStatus} />}
        </div>
      </div>
      {handles.length > 0 && (
        <div className="border-t px-3 py-1.5">
          {handles.map((h) => (
            <div key={h} className="relative flex h-5 items-center justify-end text-[10.5px] font-medium text-text-muted">
              {HANDLE_LABELS[h] ?? h.replace(/_/g, " ")}
              <Handle
                id={h}
                type="source"
                position={Position.Right}
                className={cn("!-right-[19px] !size-3 !border-2 !border-surface", h === "error" || h === "rejected" || h === "false" ? "!bg-danger" : "!bg-brand")}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
