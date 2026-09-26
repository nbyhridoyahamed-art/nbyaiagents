"use client";

import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node } from "@xyflow/react";
import { ArrowRight, GitBranch, Workflow as WorkflowIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { AgentStatusBadge } from "@/components/agents/agent-status";
import { WorkflowStatusBadge } from "@/components/workflows/workflow-status";
import { facingSides, layoutOffice } from "@/lib/office/layout";
import type { OfficeData } from "@/server/services/office";
import { cn } from "@/lib/utils";
import { EmployeeNodeView, RoomNodeView, WorkflowNodeView, type EmployeeNode, type RoomNode, type WorkflowNode } from "./office-nodes";

const nodeTypes = {
  room: RoomNodeView,
  employee: EmployeeNodeView,
  workflow: WorkflowNodeView,
};

type Selection = { kind: "agent" | "workflow"; id: string } | null;

/**
 * The AI Office (spec §103): a secondary, visual view of the workforce. Rooms are
 * departments; dashed arrows are delegation; green lines connect employees to the
 * workflows they take part in. Lines animate only while work is actually running.
 */
export function OfficeView({ data }: { data: OfficeData }) {
  return (
    <ReactFlowProvider>
      <OfficeInner data={data} />
    </ReactFlowProvider>
  );
}

/** Zooms to the selection and its connections (and back out when cleared). */
function FocusSelection({ ids, layoutKey }: { ids: string[] | null; layoutKey: string }) {
  const flow = useReactFlow();
  const first = useRef(true);
  // Keyed on the ids themselves so periodic live refreshes don't undo the user's panning.
  const key = ids?.join(",") ?? "";
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const opts = { duration: reduce ? 0 : 400, maxZoom: 1.1 };
    // Next frame: React Flow needs to have applied the new positions first.
    const raf = requestAnimationFrame(() => {
      if (key)
        void flow.fitView({
          ...opts,
          nodes: key.split(",").map((id) => ({ id })),
          padding: 0.35,
        });
      else void flow.fitView({ ...opts, padding: 0.12, maxZoom: 1 });
    });
    return () => cancelAnimationFrame(raf);
  }, [key, layoutKey, flow]);
  return null;
}

function OfficeInner({ data }: { data: OfficeData }) {
  const [selected, setSelected] = useState<Selection>(null);
  const [showDelegations, setShowDelegations] = useState(true);
  const [showWorkflows, setShowWorkflows] = useState(true);

  // Pick the room arrangement (1–3 columns) that stays most readable in the canvas' actual shape.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvas, setCanvas] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCanvas({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const layout = useMemo(() => {
    const input = {
      rooms: data.rooms,
      workflows: showWorkflows ? data.workflows : [],
    };
    const candidates = [1, 2, 3].map((cols) => layoutOffice(input, cols));
    const { w, h } = canvas ?? { w: 900, h: 560 };
    const scale = (l: (typeof candidates)[number]) => Math.min(w / Math.max(l.width, 1), h / Math.max(l.height, 1));
    return candidates.reduce((best, l) => (scale(l) > scale(best) + 0.01 ? l : best));
  }, [data, showWorkflows, canvas]);
  const layoutKey = `${Math.round(layout.width)}x${Math.round(layout.height)}`;
  const agentById = useMemo(() => new Map(data.agents.map((a) => [a.id, a])), [data.agents]);

  // What's related to the current selection (for dimming everything else).
  const related = useMemo(() => {
    if (!selected) return null;
    const ids = new Set<string>([selected.id]);
    if (selected.kind === "agent") {
      if (showDelegations) for (const d of data.delegations) if (d.from === selected.id || d.to === selected.id) ids.add(d.from).add(d.to);
      if (showWorkflows) for (const w of data.workflows) if (w.agentIds.includes(selected.id)) ids.add(w.id);
    } else {
      data.workflows.find((w) => w.id === selected.id)?.agentIds.forEach((id) => ids.add(id));
    }
    return ids;
  }, [selected, data, showDelegations, showWorkflows]);
  const nodes = useMemo<Node[]>(() => {
    const dim = (id: string) => !!related && !related.has(id);
    const out: Node[] = [];
    for (const room of data.rooms) {
      const box = layout.rooms[room.id];
      out.push({
        id: `room:${room.id}`,
        type: "room",
        position: { x: box.x, y: box.y },
        style: { width: box.width, height: box.height },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: -1,
        data: {
          name: room.name,
          color: room.color,
          icon: room.icon,
          count: room.agentIds.length,
          dimmed: !!related && !room.agentIds.some((id) => related.has(id)),
        },
      } satisfies RoomNode);
      for (const id of room.agentIds) {
        const a = agentById.get(id)!;
        const b = layout.agents[id];
        out.push({
          id,
          type: "employee",
          parentId: `room:${room.id}`,
          extent: "parent",
          position: { x: b.x, y: b.y },
          style: { width: b.width, height: b.height },
          draggable: false,
          ariaLabel: `${a.name}, ${a.jobTitle}, ${a.status.toLowerCase()}${a.activity ? `: ${a.activity}` : ""}`,
          data: {
            name: a.name,
            jobTitle: a.jobTitle,
            color: a.color,
            status: a.status,
            activity: a.activity,
            progress: a.progress,
            activeRuns: a.activeRuns,
            draft: a.lifecycle !== "PUBLISHED",
            dimmed: dim(id),
            selected: selected?.id === id,
          },
        } satisfies EmployeeNode);
      }
    }
    if (showWorkflows) {
      for (const w of data.workflows) {
        const b = layout.workflows[w.id];
        out.push({
          id: w.id,
          type: "workflow",
          position: { x: b.x, y: b.y },
          style: { width: b.width, height: b.height },
          draggable: false,
          ariaLabel: `Workflow ${w.name}, ${w.status.toLowerCase()}`,
          data: {
            name: w.name,
            status: w.status,
            activeRuns: w.activeRuns,
            runs30d: w.runs30d,
            dimmed: dim(w.id),
            selected: selected?.id === w.id,
          },
        } satisfies WorkflowNode);
      }
    }
    return out;
  }, [data, layout, agentById, related, selected, showWorkflows]);

  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = [];
    // With a selection, only lines touching the selected item stay prominent.
    const edgeDim = (a: string, b: string) => !!selected && a !== selected.id && b !== selected.id;
    if (showDelegations) {
      for (const d of data.delegations) {
        const a = layout.agentsAbsolute[d.from];
        const b = layout.agentsAbsolute[d.to];
        if (!a || !b) continue;
        const [s, t] = facingSides(a, b);
        const active = d.activeRuns > 0;
        out.push({
          id: `dlg:${d.id}`,
          source: d.from,
          target: d.to,
          sourceHandle: `s-${s}`,
          targetHandle: `t-${t}`,
          animated: active,
          zIndex: 1,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: "var(--brand)",
          },
          style: {
            stroke: "var(--brand)",
            strokeWidth: active ? 2.2 : 1.6,
            strokeDasharray: active ? undefined : "5 5",
            opacity: edgeDim(d.from, d.to) ? 0.12 : 0.85,
          },
        });
      }
    }
    if (showWorkflows) {
      for (const w of data.workflows) {
        for (const agentId of w.agentIds) {
          const a = layout.agentsAbsolute[agentId];
          const b = layout.workflows[w.id];
          if (!a || !b) continue;
          const [s, t] = facingSides(a, b);
          out.push({
            id: `wf:${w.id}:${agentId}`,
            source: agentId,
            target: w.id,
            sourceHandle: `s-${s}`,
            targetHandle: `t-${t}`,
            animated: w.activeRuns > 0,
            style: {
              stroke: "var(--success)",
              strokeWidth: w.activeRuns > 0 ? 2 : 1.3,
              opacity: edgeDim(agentId, w.id) ? 0.1 : 0.55,
            },
          });
        }
      }
    }
    return out;
  }, [data, layout, selected, showDelegations, showWorkflows]);

  // Node ids to focus: the selection plus what it connects to (only nodes that are on the canvas).
  const focusIds = useMemo(() => (related ? [...related].filter((id) => nodes.some((n) => n.id === id)) : null), [related, nodes]);

  const working = data.agents.filter((a) => a.status === "WORKING" || a.activeRuns > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section aria-label="AI Office map" className="flex h-[560px] flex-col overflow-hidden rounded-[20px] border bg-surface shadow-card lg:h-[calc(100dvh-230px)] lg:min-h-[560px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 text-[12.5px]">
          <div className="flex items-center gap-2">
            <Switch id="show-delegations" checked={showDelegations} onCheckedChange={setShowDelegations} />
            <Label htmlFor="show-delegations" className="flex items-center gap-1.5 text-[12.5px] font-normal">
              <span className="inline-block w-5 border-t-2 border-dashed border-brand" aria-hidden /> Delegation
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="show-workflows" checked={showWorkflows} onCheckedChange={setShowWorkflows} />
            <Label htmlFor="show-workflows" className="flex items-center gap-1.5 text-[12.5px] font-normal">
              <span className="inline-block w-5 border-t-2 border-success" aria-hidden /> Workflows
            </Label>
          </div>
        </div>
        <div ref={canvasRef} className="relative min-h-0 flex-1">
          {/* Rendered once the canvas is measured, so the first fit uses the right layout. */}
          {canvas && (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              onNodeClick={(_, n) => {
                if (n.type === "employee") setSelected({ kind: "agent", id: n.id });
                else if (n.type === "workflow") setSelected({ kind: "workflow", id: n.id });
              }}
              onPaneClick={() => setSelected(null)}
              fitView
              fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
              minZoom={0.25}
              maxZoom={1.6}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="var(--border)" />
              <Controls showInteractive={false} />
              <FocusSelection ids={focusIds} layoutKey={layoutKey} />
            </ReactFlow>
          )}
        </div>
      </section>

      <aside className="rounded-[20px] border bg-surface p-5 shadow-card lg:max-h-[calc(100dvh-230px)] lg:min-h-[560px] lg:overflow-y-auto" aria-live="polite">
        {selected ? (
          <SelectionPanel selection={selected} data={data} onClose={() => setSelected(null)} onSelect={setSelected} />
        ) : (
          <OverviewPanel data={data} working={working} onSelect={setSelected} />
        )}
      </aside>
    </div>
  );
}

function OverviewPanel({ data, working, onSelect }: { data: OfficeData; working: OfficeData["agents"]; onSelect: (s: Selection) => void }) {
  const activeDelegations = data.delegations.filter((d) => d.activeRuns > 0).length;
  const runningWorkflows = data.workflows.filter((w) => w.activeRuns > 0).length;
  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-card-title">Right now</h2>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            ["Working", working.length],
            ["Handoffs", activeDelegations],
            ["Workflows", runningWorkflows],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-surface-2 px-2 py-2.5">
              <dd className="text-[20px] font-semibold tabular-nums">{v}</dd>
              <dt className="text-[11.5px] text-text-muted">{k}</dt>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <h3 className="text-[13px] font-semibold">Busy employees</h3>
        {working.length === 0 ? (
          <p className="mt-2 text-[13px] text-text-muted">Nobody is working on anything right now.</p>
        ) : (
          <ul className="mt-2 grid gap-1">
            {working.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => onSelect({ kind: "agent", id: a.id })} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
                  <AgentAvatar name={a.name} color={a.color} size={28} status={a.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{a.name}</span>
                    <span className="block truncate text-xs text-text-muted">{a.activity ?? "Working"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-text-muted">
        Select an employee or workflow to see their connections. This view is a map of your workforce — use the{" "}
        <Link href="/dashboard" className="text-brand hover:underline">
          dashboard
        </Link>{" "}
        for day-to-day work.
      </p>
    </div>
  );
}

function SelectionPanel({ selection, data, onClose, onSelect }: { selection: NonNullable<Selection>; data: OfficeData; onClose: () => void; onSelect: (s: Selection) => void }) {
  const agent = (id: string) => data.agents.find((a) => a.id === id);
  const header = (children: React.ReactNode) => (
    <div className="flex items-start justify-between gap-2">
      {children}
      <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close details">
        <X aria-hidden />
      </Button>
    </div>
  );
  const personLink = (id: string, note?: string) => {
    const a = agent(id);
    if (!a) return null;
    return (
      <li key={id + (note ?? "")}>
        <button type="button" onClick={() => onSelect({ kind: "agent", id })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface-2">
          <AgentAvatar name={a.name} color={a.color} size={24} />
          <span className="flex-1">{a.name}</span>
          {note && <span className="text-xs text-text-muted">{note}</span>}
        </button>
      </li>
    );
  };

  if (selection.kind === "workflow") {
    const w = data.workflows.find((x) => x.id === selection.id);
    if (!w) return null;
    return (
      <div className="grid gap-4">
        {header(
          <div className="flex min-w-0 items-center gap-2">
            <WorkflowIcon className="size-5 shrink-0 text-success" aria-hidden />
            <h2 className="truncate text-card-title">{w.name}</h2>
          </div>,
        )}
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <WorkflowStatusBadge status={w.status} />
          <span className="text-text-muted">
            {w.activeRuns > 0 ? `${w.activeRuns} running now · ` : ""}
            {w.runs30d} live run{w.runs30d === 1 ? "" : "s"} in 30 days
          </span>
        </div>
        <div>
          <h3 className="text-[13px] font-semibold">Employees involved</h3>
          {w.agentIds.length ? <ul className="mt-1 grid">{w.agentIds.map((id) => personLink(id))}</ul> : <p className="mt-1 text-[13px] text-text-muted">No employee steps.</p>}
        </div>
        <Button asChild variant="outline">
          <Link href={`/workflows/${w.id}`}>
            Open workflow <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    );
  }

  const a = agent(selection.id);
  if (!a) return null;
  const delegatesTo = data.delegations.filter((d) => d.from === a.id);
  const delegatedBy = data.delegations.filter((d) => d.to === a.id);
  const workflows = data.workflows.filter((w) => w.agentIds.includes(a.id));
  const room = data.rooms.find((r) => r.agentIds.includes(a.id));
  const runs = (n: number, active: number) => (active ? `${active} active` : n ? `${n} in 30d` : undefined);
  return (
    <div className="grid gap-4">
      {header(
        <div className="flex min-w-0 items-center gap-3">
          <AgentAvatar name={a.name} color={a.color} size={44} status={a.status} />
          <div className="min-w-0">
            <h2 className="truncate text-card-title">{a.name}</h2>
            <p className="truncate text-[13px] text-text-secondary">{a.jobTitle}</p>
          </div>
        </div>,
      )}
      <div className="flex flex-wrap items-center gap-2">
        <AgentStatusBadge status={a.status} />
        {room && <span className="text-xs text-text-muted">{room.name}</span>}
      </div>
      <div className="rounded-xl bg-surface-2 p-3 text-[13px]">
        <p className="text-xs font-medium text-text-muted">Current work</p>
        <p className="mt-0.5">{a.activity ?? "No active work."}</p>
        {a.progress !== null && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={a.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
            <div className="h-full rounded-full bg-brand" style={{ width: `${a.progress}%` }} />
          </div>
        )}
      </div>
      <div>
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <GitBranch className="size-3.5 text-brand" aria-hidden /> Delegation
        </h3>
        {delegatesTo.length + delegatedBy.length === 0 ? (
          <p className="mt-1 text-[13px] text-text-muted">Works independently.</p>
        ) : (
          <>
            {delegatesTo.length > 0 && (
              <>
                <p className="mt-1.5 text-xs text-text-muted">Hands work to</p>
                <ul className="grid">{delegatesTo.map((d) => personLink(d.to, runs(d.recentRuns, d.activeRuns)))}</ul>
              </>
            )}
            {delegatedBy.length > 0 && (
              <>
                <p className="mt-1.5 text-xs text-text-muted">Receives work from</p>
                <ul className="grid">{delegatedBy.map((d) => personLink(d.from, runs(d.recentRuns, d.activeRuns)))}</ul>
              </>
            )}
          </>
        )}
      </div>
      <div>
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <WorkflowIcon className="size-3.5 text-success" aria-hidden /> Workflows
        </h3>
        {workflows.length === 0 ? (
          <p className="mt-1 text-[13px] text-text-muted">Not part of any workflow.</p>
        ) : (
          <ul className="mt-1 grid">
            {workflows.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => onSelect({ kind: "workflow", id: w.id })}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface-2"
                >
                  <span className="truncate">{w.name}</span>
                  <span className={cn("text-xs", w.activeRuns ? "text-success-text" : "text-text-muted")}>{w.activeRuns ? "running" : w.status.toLowerCase()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button asChild variant="outline">
        <Link href={`/agents/${a.id}`}>
          Open workspace <ArrowRight aria-hidden />
        </Link>
      </Button>
    </div>
  );
}
