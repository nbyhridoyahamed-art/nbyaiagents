"use client";

import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, AlertTriangle, ArrowLeft, CheckCircle2, Copy, FlaskConical, Loader2, Pause, Play, Rocket, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RunStatusBadge } from "@/components/runs/run-status";
import { WorkflowStatusBadge } from "./workflow-status";
import { FlowNodeView, type FlowNode } from "./flow-node";
import { NodeConfigPanel } from "./node-config";
import { WebhookSecret } from "./webhook-secret";
import { CATEGORY_STYLES, NODE_ICONS, defaultConfig } from "./node-visuals";
import type { WorkflowEditorProps } from "./editor-types";
import { NODE_CATALOG, isTrigger, nodeMeta, type NodeCategory, type NodeType, type WorkflowGraph, type WorkflowSettings } from "@/lib/workflows/types";
import { handlesFor, type GraphIssue } from "@/lib/workflows/validate-graph";
import { describeConditionGroup } from "@/lib/workflows/expressions";
import { cn } from "@/lib/utils";
import { publishWorkflowAction, runWorkflowAction, saveDraftAction, setWorkflowPausedAction, simulateWorkflowAction } from "@/app/(app)/workflows/actions";

const nodeTypes = { step: FlowNodeView };
const CATEGORIES: NodeCategory[] = ["Triggers", "AI", "Agents", "Tools", "Logic", "Human", "Data"];
type RunStatus = "QUEUED" | "RUNNING" | "WAITING" | "AWAITING_APPROVAL" | "COMPLETED" | "FAILED" | "CANCELLED";

function toFlow(graph: WorkflowGraph): { nodes: FlowNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({ id: n.key, type: "step", position: n.position, data: { type: n.type, label: n.label, config: n.config } })),
    edges: graph.edges.map((e) => ({ id: e.key, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? "out", label: e.label ?? undefined })),
  };
}

function toGraph(nodes: FlowNode[], edges: Edge[]): WorkflowGraph {
  return {
    nodes: nodes.map((n) => ({ key: n.id, type: n.data.type, label: n.data.label, config: n.data.config, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } })),
    edges: edges.map((e) => ({ key: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? "out" })),
  };
}

function summarize(type: NodeType, config: Record<string, unknown>, options: WorkflowEditorProps["options"]): string | undefined {
  try {
    if (type === "tool.call") return options.tools.find((t) => t.key === config.toolKey)?.name ?? "Choose a tool";
    if (type === "agent.run" || type === "ai.research") return options.agents.find((a) => a.id === config.agentId)?.name ?? "Choose an employee";
    if (type === "logic.if" || type === "logic.filter") return describeConditionGroup(config.condition as never);
    if (type === "trigger.schedule") return String(config.cron ?? "");
    if (type === "trigger.event") return config.event === "email.received" ? "New email" : "New CRM lead";
    if (type === "ai.classify") return ((config.categories as string[]) ?? []).join(" · ");
    if (type === "logic.delay") return `${Math.round(Number(config.seconds ?? 0) / 60)} min`;
    if (type === "logic.loop") return String(config.items ?? "");
    const text = (config.prompt ?? config.instructions ?? config.title ?? config.question) as string | undefined;
    return text ? text.slice(0, 80) : undefined;
  } catch {
    return undefined;
  }
}

function newKey(type: NodeType, existing: Set<string>) {
  const base = type.split(".")[1].replace(/[^a-z_]/g, "");
  for (let i = 1; i < 999; i++) {
    const key = `${base}_${i}`;
    if (!existing.has(key)) return key;
  }
  return `${base}_${Date.now().toString(36)}`;
}

export function WorkflowEditor(props: WorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}

function EditorInner({ workflow, graph, settings: initialSettings, options, initialIssues, runs, webhookUrl, webhookEnabled, permissions, autoOpenRun }: WorkflowEditorProps) {
  const router = useRouter();
  const flow = useReactFlow();
  const initial = useMemo(() => toFlow(graph), [graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(workflow.name);
  const [settings, setSettings] = useState<WorkflowSettings>(initialSettings);
  const [issues, setIssues] = useState<GraphIssue[]>(initialIssues);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<null | "simulate" | "publish" | "run" | "pause">(null);
  const [payloadDialog, setPayloadDialog] = useState<null | "simulate" | "run">(null);
  const [payloadText, setPayloadText] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify({ g: toGraph(initial.nodes, initial.edges), s: initialSettings, n: workflow.name }));
  const readOnly = !permissions.write;

  const currentSnapshot = JSON.stringify({ g: toGraph(nodes, edges), s: settings, n: name });
  const dirty = currentSnapshot !== savedSnapshot;

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Decorate nodes with summaries and validation markers.
  const issueByNode = useMemo(() => {
    const m = new Map<string, "error" | "warning">();
    for (const i of issues) if (i.nodeKey && m.get(i.nodeKey) !== "error") m.set(i.nodeKey, i.level);
    return m;
  }, [issues]);
  const displayNodes = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, summary: summarize(n.data.type, n.data.config, options), issue: issueByNode.get(n.id) } })),
    [nodes, options, issueByNode],
  );
  const displayEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: { strokeWidth: 1.6, stroke: e.sourceHandle === "error" || e.sourceHandle === "rejected" || e.sourceHandle === "false" ? "var(--danger)" : "var(--border-strong)" },
      })),
    [edges],
  );

  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  const variables = useMemo(() => {
    const vars = new Set<string>(["workflow.id", "company.name"]);
    for (const n of nodes) {
      const cfg = n.data.config as { outputVar?: string; inputFields?: string[]; assignments?: { name: string }[]; itemVar?: string };
      if (cfg.outputVar) vars.add(cfg.outputVar);
      cfg.inputFields?.forEach((f) => f && vars.add(f));
      cfg.assignments?.forEach((a) => a.name && vars.add(a.name));
      if (n.data.type === "logic.loop") vars.add(cfg.itemVar ?? "item");
      if (!isTrigger(n.data.type) && n.id !== selectedId) vars.add(`nodes.${n.id}`);
    }
    return [...vars];
  }, [nodes, selectedId]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (readOnly || !c.source || !c.target) return;
      const target = nodes.find((n) => n.id === c.target);
      if (target && isTrigger(target.data.type)) return toast.error("Nothing can connect into a trigger.");
      if (c.source === c.target) return;
      setEdges((eds) => {
        if (eds.some((e) => e.source === c.source && e.target === c.target && (e.sourceHandle ?? "out") === (c.sourceHandle ?? "out"))) return eds;
        return addEdge({ ...c, id: `e_${c.source}_${c.sourceHandle ?? "out"}_${c.target}` }, eds);
      });
    },
    [nodes, readOnly, setEdges],
  );

  const addNode = useCallback(
    (type: NodeType, position?: { x: number; y: number }) => {
      if (readOnly) return;
      if (isTrigger(type) && nodes.some((n) => isTrigger(n.data.type))) {
        toast.error("A workflow can have only one trigger. Replace it by deleting the current one first.");
        return;
      }
      const meta = nodeMeta(type)!;
      const keys = new Set(nodes.map((n) => n.id));
      const id = newKey(type, keys);
      // Adding while a step is selected appends after it and connects its first free output.
      const after = !position && !isTrigger(type) ? nodes.find((n) => n.id === selectedId) : undefined;
      let pos = position;
      if (!pos && after) {
        const siblings = edges.filter((e) => e.source === after.id).length;
        pos = { x: after.position.x + 300, y: after.position.y + siblings * 150 };
      }
      if (!pos) {
        const center = flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        pos = { x: center.x - 110 + (nodes.length % 4) * 30, y: center.y - 40 + (nodes.length % 4) * 30 };
      }
      const node: FlowNode = { id, type: "step", position: pos, data: { type, label: meta.label, config: defaultConfig(type) } };
      setNodes((ns) => [...ns, node]);
      if (after) {
        const handles = handlesFor({ key: after.id, type: after.data.type, label: after.data.label, config: after.data.config, position: after.position }).filter((h) => h !== "error");
        const free = handles.find((h) => !edges.some((e) => e.source === after.id && (e.sourceHandle ?? "out") === h));
        if (free) setEdges((es) => [...es, { id: `e_${after.id}_${free}_${id}`, source: after.id, target: id, sourceHandle: free }]);
      }
      setSelectedId(id);
    },
    [edges, flow, nodes, readOnly, selectedId, setEdges, setNodes],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/nby-node") as NodeType;
      if (!type) return;
      addNode(type, flow.screenToFlowPosition({ x: e.clientX - 110, y: e.clientY - 30 }));
    },
    [addNode, flow],
  );

  async function save(): Promise<boolean> {
    setSaving(true);
    const res = await saveDraftAction({ workflowId: workflow.id, graph: toGraph(nodes, edges), settings, name });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setSavedSnapshot(currentSnapshot);
    setIssues(res.data.issues);
    const errors = res.data.issues.filter((i) => i.level === "error").length;
    toast.success(`Saved draft v${res.data.version}${errors ? ` · ${errors} issue${errors === 1 ? "" : "s"} to fix` : ""}`);
    router.refresh();
    return true;
  }

  function openPayload(kind: "simulate" | "run") {
    const trigger = nodes.find((n) => isTrigger(n.data.type));
    const fields = ((trigger?.data.config.inputFields as string[]) ?? []).filter(Boolean);
    const sample: Record<string, unknown> = {};
    for (const f of fields) {
      const parts = f.split(".");
      let cur = sample;
      parts.forEach((p, i) => {
        if (i === parts.length - 1) cur[p] = f.includes("email") ? "someone@example.com" : `sample ${p}`;
        else cur = (cur[p] ??= {}) as Record<string, unknown>;
      });
    }
    setPayloadText(JSON.stringify(Object.keys(sample).length ? sample : { lead: { name: "Dana Ortiz", email: "dana@example.com", company: "Initrode" } }, null, 2));
    setPayloadDialog(kind);
  }

  // Arriving with ?run=1 on an active workflow: open the run dialog straight away.
  const autoRunDone = useRef(false);
  useEffect(() => {
    if (autoOpenRun && !autoRunDone.current && workflow.status === "ACTIVE" && permissions.run) {
      autoRunDone.current = true;
      openPayload("run");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on arrival
  }, []);

  async function submitPayload() {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadText || "{}");
    } catch {
      toast.error("The input must be valid JSON.");
      return;
    }
    const kind = payloadDialog!;
    if (kind === "simulate" && dirty && !(await save())) return;
    setBusy(kind);
    const res = kind === "simulate" ? await simulateWorkflowAction({ workflowId: workflow.id, payload }) : await runWorkflowAction({ workflowId: workflow.id, payload });
    setBusy(null);
    setPayloadDialog(null);
    if (!res.ok) return void toast.error(res.error);
    toast.success(kind === "simulate" ? "Simulation started — nothing real will happen." : "Workflow started.");
    router.push(`/workflows/runs/${res.data.runId}`);
  }

  async function publish() {
    if (dirty && !(await save())) return;
    setBusy("publish");
    const res = await publishWorkflowAction(workflow.id);
    setBusy(null);
    if (!res.ok) return void toast.error(res.error, { duration: 8000 });
    toast.success(`Published v${res.data.version}. The workflow is now active.`);
    router.refresh();
  }

  async function togglePause() {
    setBusy("pause");
    const res = await setWorkflowPausedAction({ workflowId: workflow.id, paused: workflow.status === "ACTIVE" });
    setBusy(null);
    if (!res.ok) return void toast.error(res.error);
    router.refresh();
  }

  const errors = issues.filter((i) => i.level === "error");
  const canPublish = permissions.publish && !workflow.draftIsPublished;
  const needsSimulation = !workflow.lastSimulationOk || dirty;

  return (
    <div className="flex h-[calc(100dvh-64px)] flex-col lg:h-[calc(100dvh-72px)]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-surface px-3 py-2 lg:px-5">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to workflows">
          <Link href="/workflows">
            <ArrowLeft aria-hidden />
          </Link>
        </Button>
        <Input value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} className="h-8 w-56 border-transparent px-2 text-[14px] font-semibold shadow-none hover:border-border" aria-label="Workflow name" />
        <WorkflowStatusBadge status={workflow.status} />
        <span className="text-xs text-text-muted">
          {workflow.publishedVersion ? `v${workflow.publishedVersion} live` : "not published"}
          {!workflow.draftIsPublished && ` · editing draft v${workflow.draftVersion}`}
        </span>
        {dirty && <span className="rounded bg-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-warning-text">Unsaved changes</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!readOnly && (
            <Button variant="outline" size="sm" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} Save
            </Button>
          )}
          {permissions.write && (
            <Button variant="outline" size="sm" onClick={() => openPayload("simulate")} disabled={!!busy}>
              <FlaskConical aria-hidden className="text-ai" /> Test (simulate)
            </Button>
          )}
          {canPublish && (
            <Button
              size="sm"
              onClick={() => void publish()}
              disabled={!!busy || errors.length > 0 || needsSimulation}
              title={errors.length ? "Fix the errors first" : needsSimulation ? "Run a successful simulation of this version first" : undefined}
            >
              {busy === "publish" ? <Loader2 className="animate-spin" aria-hidden /> : <Rocket aria-hidden />} Publish
            </Button>
          )}
          {workflow.status === "ACTIVE" && permissions.run && (
            <Button size="sm" variant="outline" onClick={() => openPayload("run")} disabled={!!busy}>
              <Play aria-hidden /> Run now
            </Button>
          )}
          {workflow.publishedVersion !== null && permissions.publish && (
            <Button size="sm" variant="ghost" onClick={() => void togglePause()} disabled={!!busy}>
              {workflow.status === "ACTIVE" ? <Pause aria-hidden /> : <Play aria-hidden />} {workflow.status === "ACTIVE" ? "Pause" : "Resume"}
            </Button>
          )}
        </div>
      </div>
      {canPublish && needsSimulation && errors.length === 0 && (
        <div className="border-b bg-ai-soft px-5 py-1.5 text-xs text-ai">Draft → Test → Publish: run a successful simulation of this version to enable publishing.</div>
      )}

      <div className="border-b bg-surface-2 px-4 py-1.5 text-xs text-text-secondary lg:hidden">The builder works best on a larger screen — step settings open in the side panel on desktop.</div>
      <div className="flex min-h-0 flex-1">
        {/* Palette */}
        {!readOnly && (
          <aside className="hidden w-56 shrink-0 overflow-y-auto border-r bg-surface p-3 md:block" aria-label="Steps">
            {CATEGORIES.map((cat) => (
              <div key={cat} className="mb-4">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: CATEGORY_STYLES[cat].accent }}>
                  {cat}
                </p>
                <ul className="grid gap-1">
                  {NODE_CATALOG.filter((n) => n.category === cat).map((n) => {
                    const Icon = NODE_ICONS[n.icon];
                    return (
                      <li key={n.type}>
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("application/nby-node", n.type);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onClick={() => addNode(n.type)}
                          title={n.description}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-2"
                        >
                          {Icon && <Icon className="size-3.5 shrink-0" style={{ color: CATEGORY_STYLES[cat].accent }} aria-hidden />}
                          {n.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </aside>
        )}

        {/* Canvas */}
        <div className="relative min-w-0 flex-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            onNodesChange={readOnly ? undefined : onNodesChange}
            onEdgesChange={readOnly ? undefined : onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            deleteKeyCode={readOnly ? null : ["Delete", "Backspace"]}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="var(--border-strong)" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!hidden lg:!block" nodeColor={(n) => CATEGORY_STYLES[nodeMeta((n.data as { type: string }).type)?.category ?? "Data"].accent} />
          </ReactFlow>
          {nodes.length <= 1 && (
            <div className="pointer-events-none absolute inset-x-0 top-6 mx-auto w-fit rounded-lg border bg-surface px-3 py-2 text-[12.5px] text-text-secondary shadow-card">
              Click or drag steps from the left, then connect outputs (right) to inputs (left).
            </div>
          )}
        </div>

        {/* Inspector */}
        <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-l bg-surface p-4 lg:block" aria-label="Inspector">
          {selected ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-card-title">Configure step</h2>
                <Button variant="ghost" size="icon-sm" onClick={() => setSelectedId(null)} aria-label="Close">
                  <X aria-hidden />
                </Button>
              </div>
              {issues.filter((i) => i.nodeKey === selected.id).map((i, idx) => (
                <IssueRow key={idx} issue={i} />
              ))}
              <NodeConfigPanel
                key={selected.id}
                nodeKey={selected.id}
                type={selected.data.type}
                label={selected.data.label}
                config={selected.data.config}
                options={options}
                variables={variables}
                readOnly={readOnly}
                onChange={(patch) =>
                  setNodes((ns) =>
                    ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, ...(patch.label !== undefined ? { label: patch.label } : {}), ...(patch.config ? { config: patch.config } : {}) } } : n)),
                  )
                }
                onDelete={() => {
                  setNodes((ns) => ns.filter((n) => n.id !== selected.id));
                  setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id));
                  setSelectedId(null);
                }}
              />
            </>
          ) : (
            <WorkflowPanel
              issues={issues}
              settings={settings}
              setSettings={setSettings}
              options={options}
              runs={runs}
              webhookUrl={webhookUrl}
              webhookEnabled={webhookEnabled}
              readOnly={readOnly}
              onSelectNode={setSelectedId}
              workflowId={workflow.id}
              canPublish={permissions.publish}
            />
          )}
        </aside>
      </div>

      <Dialog open={!!payloadDialog} onOpenChange={(o) => !o && setPayloadDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{payloadDialog === "simulate" ? "Test with a simulation" : "Run workflow"}</DialogTitle>
            <DialogDescription>
              {payloadDialog === "simulate"
                ? "Runs the current draft end-to-end. Tools are previewed, approvals are assumed, delays are skipped — nothing real happens."
                : "Runs the published version for real. Actions that need approval will pause for you."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label className="text-[13px]">Trigger input (JSON)</Label>
            <Textarea className="min-h-40 font-mono text-xs" value={payloadText} onChange={(e) => setPayloadText(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayloadDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitPayload()} disabled={!!busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : payloadDialog === "simulate" ? <FlaskConical aria-hidden /> : <Play aria-hidden />}
              {payloadDialog === "simulate" ? "Run simulation" : "Run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IssueRow({ issue, onClick }: { issue: GraphIssue; onClick?: () => void }) {
  return (
    <div className={cn("mb-2 flex gap-2 rounded-lg px-2.5 py-2 text-[12.5px]", issue.level === "error" ? "bg-danger-soft text-danger-text" : "bg-warning-soft text-warning-text")}>
      {issue.level === "error" ? <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-label="Error" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-label="Warning" />}
      <span className="min-w-0">
        {onClick ? (
          <button type="button" onClick={onClick} className="text-left hover:underline">
            {issue.message}
          </button>
        ) : (
          issue.message
        )}
        {issue.fix && (
          <Link href={issue.fix.href} className="ml-1 font-semibold underline">
            {issue.fix.label}
          </Link>
        )}
      </span>
    </div>
  );
}

function WorkflowPanel({
  issues,
  settings,
  setSettings,
  options,
  runs,
  webhookUrl,
  webhookEnabled,
  readOnly,
  onSelectNode,
  workflowId,
  canPublish,
}: {
  workflowId: string;
  canPublish: boolean;
  issues: GraphIssue[];
  settings: WorkflowSettings;
  setSettings: (s: WorkflowSettings) => void;
  options: WorkflowEditorProps["options"];
  runs: WorkflowEditorProps["runs"];
  webhookUrl: string | null;
  webhookEnabled: boolean;
  readOnly: boolean;
  onSelectNode: (key: string) => void;
}) {
  const num = (k: keyof WorkflowSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, [k]: Number(e.target.value) });
  return (
    <Tabs defaultValue="checks">
      <TabsList className="w-full">
        <TabsTrigger value="checks">
          Checks {issues.filter((i) => i.level === "error").length > 0 && <span className="ml-1 rounded-full bg-danger px-1.5 text-[10px] text-white">{issues.filter((i) => i.level === "error").length}</span>}
        </TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
        <TabsTrigger value="runs">Runs</TabsTrigger>
      </TabsList>
      <TabsContent value="checks" className="mt-3">
        {issues.length === 0 ? (
          <p className="flex items-center gap-2 text-[13px] text-success-text">
            <CheckCircle2 className="size-4" aria-hidden /> No problems found in the saved draft.
          </p>
        ) : (
          issues.map((i, idx) => <IssueRow key={idx} issue={i} onClick={i.nodeKey ? () => onSelectNode(i.nodeKey!) : undefined} />)
        )}
        <p className="mt-2 text-[11px] text-text-muted">Checks run on save. Select a step to configure it.</p>
        {webhookUrl && (
          <div className="mt-4 grid gap-1.5 rounded-lg border p-3">
            <p className="text-[12.5px] font-medium">Webhook URL {webhookEnabled ? "" : "(disabled)"}</p>
            <div className="flex gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1 text-[11px]">{webhookUrl}</code>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => {
                  void navigator.clipboard.writeText(webhookUrl);
                  toast.success("Webhook URL copied");
                }}
                aria-label="Copy webhook URL"
              >
                <Copy aria-hidden />
              </Button>
            </div>
            <WebhookSecret workflowId={workflowId} canManage={canPublish} />
          </div>
        )}
      </TabsContent>
      <TabsContent value="settings" className="mt-3 grid gap-3">
        <div className="grid gap-1.5">
          <Label className="text-[12.5px]">Default employee</Label>
          <Select value={settings.defaultAgentId ?? "none"} onValueChange={(v) => setSettings({ ...settings, defaultAgentId: v === "none" ? null : v })} disabled={readOnly}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {options.agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} · {a.jobTitle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-text-muted">Tool steps act as this employee unless a step picks someone else.</p>
        </div>
        <p className="text-[12.5px] font-medium">Limits (per run)</p>
        {(
          [
            ["maxSteps", "Max steps"],
            ["maxToolCalls", "Max tool calls"],
            ["maxTokens", "Max AI tokens"],
            ["maxCostUsd", "Max est. cost (USD)"],
            ["timeoutMinutes", "Timeout (minutes)"],
          ] as [keyof WorkflowSettings, string][]
        ).map(([k, label]) => (
          <div key={k} className="flex items-center justify-between gap-2 text-[12.5px]">
            <span>{label}</span>
            <Input className="h-8 w-28" type="number" min={0} value={String(settings[k] ?? "")} onChange={num(k)} disabled={readOnly} aria-label={label} />
          </div>
        ))}
        <p className="text-[11px] text-text-muted">Runs stop safely and escalate to a human when a limit is reached. Cycles are not allowed; use a Loop step.</p>
      </TabsContent>
      <TabsContent value="runs" className="mt-3">
        {runs.length === 0 ? (
          <p className="text-[13px] text-text-muted">No runs yet.</p>
        ) : (
          <ul className="grid gap-2">
            {runs.map((r) => (
              <li key={r.id}>
                <Link href={`/workflows/runs/${r.id}`} className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 hover:bg-surface-2">
                  <span className="min-w-0">
                    <span className="block font-mono text-[11px]">{r.id}</span>
                    <span className="block text-[11px] text-text-muted">
                      v{r.version} · {r.mode === "SIMULATION" ? "simulation" : "live"} · {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                    </span>
                  </span>
                  <RunStatusBadge status={r.status as RunStatus} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
    </Tabs>
  );
}
