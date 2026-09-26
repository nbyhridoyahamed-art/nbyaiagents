"use client";

import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, type Edge } from "@xyflow/react";
import type { WorkflowGraph } from "@/lib/workflows/types";
import { FlowNodeView, type FlowNode } from "./flow-node";

const nodeTypes = { step: FlowNodeView };

/** Read-only graph with each step coloured by its outcome in this run. */
export function RunGraph({ graph, statuses }: { graph: WorkflowGraph; statuses: Record<string, string> }) {
  const nodes = useMemo<FlowNode[]>(
    () => graph.nodes.map((n) => ({ id: n.key, type: "step", position: n.position, data: { type: n.type, label: n.label, config: n.config, runStatus: statuses[n.key] } })),
    [graph, statuses],
  );
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((e) => {
        const reached = ["COMPLETED", "RUNNING", "WAITING", "FAILED"].includes(statuses[e.target] ?? "");
        return {
          id: e.key,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? "out",
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          animated: statuses[e.target] === "RUNNING" || statuses[e.target] === "WAITING",
          style: { strokeWidth: reached ? 2 : 1.2, stroke: reached ? "var(--brand)" : "var(--border-strong)", opacity: reached ? 1 : 0.6 },
        };
      }),
    [graph, statuses],
  );
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }} minZoom={0.15} proOptions={{ hideAttribution: true }}>
      <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="var(--border-strong)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
