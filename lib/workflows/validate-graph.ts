import { NODE_CONFIG_SCHEMAS, isTrigger, nodeMeta, type GraphEdge, type GraphNode, type WorkflowGraph } from "@/lib/workflows/types";
import { referencedPaths } from "@/lib/workflows/expressions";

export interface GraphIssue {
  level: "error" | "warning";
  message: string;
  nodeKey?: string;
  fix?: { label: string; href: string };
}

const LOOP_BODY_ALLOWED = new Set(["ai.prompt", "ai.analyze", "ai.summarize", "ai.classify", "ai.extract", "ai.generate", "ai.decision", "tool.call", "data.set", "data.transform", "data.parse_json", "data.store", "logic.filter"]);

export function outgoing(graph: WorkflowGraph, key: string, handle?: string) {
  return graph.edges.filter((e) => e.source === key && (handle === undefined || (e.sourceHandle ?? "out") === handle));
}

export function incoming(graph: WorkflowGraph, key: string) {
  return graph.edges.filter((e) => e.target === key);
}

export function handlesFor(node: GraphNode): string[] {
  const meta = nodeMeta(node.type);
  if (!meta) return [];
  let handles = meta.handles === "dynamic" ? [...((node.config.cases as { handle: string }[] | undefined) ?? []).map((c) => c.handle), "default"] : [...meta.handles];
  if (meta.errorHandle) handles = [...handles, "error"];
  return handles;
}

/** Nodes inside a loop body: reachable from the loop's "each" handle, before rejoining the main flow. */
export function loopBody(graph: WorkflowGraph, loopKey: string): string[] {
  const body: string[] = [];
  const stack = outgoing(graph, loopKey, "each").map((e) => e.target);
  while (stack.length) {
    const k = stack.pop()!;
    if (body.includes(k) || k === loopKey) continue;
    body.push(k);
    for (const e of outgoing(graph, k)) stack.push(e.target);
  }
  return body;
}

function findCycle(graph: WorkflowGraph): string[] | null {
  const state = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];
  const visit = (k: string): string[] | null => {
    state.set(k, 1);
    path.push(k);
    for (const e of outgoing(graph, k)) {
      const s = state.get(e.target) ?? 0;
      if (s === 1) return path.slice(path.indexOf(e.target));
      if (s === 0) {
        const c = visit(e.target);
        if (c) return c;
      }
    }
    path.pop();
    state.set(k, 2);
    return null;
  };
  for (const n of graph.nodes) {
    if ((state.get(n.key) ?? 0) === 0) {
      const c = visit(n.key);
      if (c) return c;
    }
  }
  return null;
}

/** Structural validation (spec §112). Environment checks (tools, agents, credentials) live server-side. */
export function validateGraph(graph: WorkflowGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const byKey = new Map(graph.nodes.map((n) => [n.key, n]));
  const triggers = graph.nodes.filter((n) => isTrigger(n.type));

  if (graph.nodes.length === 0) return [{ level: "error", message: "The workflow is empty. Add a trigger and at least one step." }];
  if (triggers.length === 0) issues.push({ level: "error", message: "Add a trigger (Manual, Schedule, Webhook, API or Event) so the workflow knows when to start." });
  if (triggers.length > 1) issues.push({ level: "error", message: "A workflow can have only one trigger." });
  if (graph.nodes.length === triggers.length) issues.push({ level: "error", message: "Add at least one step after the trigger." });

  const keys = new Set<string>();
  for (const n of graph.nodes) {
    if (keys.has(n.key)) issues.push({ level: "error", message: `Two steps share the id “${n.key}”.`, nodeKey: n.key });
    keys.add(n.key);
  }

  for (const e of graph.edges) {
    const src = byKey.get(e.source);
    const tgt = byKey.get(e.target);
    if (!src || !tgt) {
      issues.push({ level: "error", message: "A connection points to a step that no longer exists. Delete the broken connection." });
      continue;
    }
    if (isTrigger(tgt.type)) issues.push({ level: "error", message: `Nothing can connect into the trigger “${tgt.label}”.`, nodeKey: tgt.key });
    const handle = e.sourceHandle ?? "out";
    if (!handlesFor(src).includes(handle)) issues.push({ level: "error", message: `“${src.label}” has no output named “${handle}”.`, nodeKey: src.key });
    if (e.source === e.target) issues.push({ level: "error", message: `“${src.label}” connects to itself.`, nodeKey: src.key });
  }

  const cycle = findCycle(graph);
  if (cycle) {
    issues.push({
      level: "error",
      message: `The steps ${cycle.map((k) => `“${byKey.get(k)?.label ?? k}”`).join(" → ")} form an endless cycle. Use a Loop step to repeat work safely.`,
      nodeKey: cycle[0],
    });
  }

  // Reachability from the trigger
  if (triggers.length === 1) {
    const seen = new Set<string>([triggers[0].key]);
    const stack = [triggers[0].key];
    while (stack.length) {
      const k = stack.pop()!;
      for (const e of outgoing(graph, k)) {
        if (!seen.has(e.target)) {
          seen.add(e.target);
          stack.push(e.target);
        }
      }
    }
    for (const n of graph.nodes) {
      if (!seen.has(n.key)) issues.push({ level: "error", message: `“${n.label}” can't be reached from the trigger. Connect it or delete it.`, nodeKey: n.key });
    }
    if (outgoing(graph, triggers[0].key).length === 0 && graph.nodes.length > 1) {
      issues.push({ level: "error", message: `Connect the trigger “${triggers[0].label}” to the first step.`, nodeKey: triggers[0].key });
    }
  }

  // Node configuration
  const declaredVars = new Set<string>();
  for (const n of graph.nodes) {
    const schema = NODE_CONFIG_SCHEMAS[n.type];
    if (!schema) {
      issues.push({ level: "error", message: `Unknown step type “${n.type}”.`, nodeKey: n.key });
      continue;
    }
    const res = schema.safeParse(n.config);
    if (!res.success) {
      for (const i of res.error.issues.slice(0, 3)) {
        issues.push({ level: "error", message: `“${n.label}”: ${i.path.length ? `${i.path.join(".")} — ` : ""}${i.message}`, nodeKey: n.key });
      }
    }
    const outVar = (n.config as { outputVar?: string }).outputVar;
    if (outVar) declaredVars.add(outVar);
    if (n.type === "data.set") for (const a of (n.config.assignments as { name: string }[] | undefined) ?? []) declaredVars.add(a.name.split(".")[0]);
    if (n.type === "logic.loop") declaredVars.add(String(n.config.itemVar ?? "item"));
  }

  // Loops: bodies must be simple, synchronous steps.
  for (const n of graph.nodes.filter((x) => x.type === "logic.loop")) {
    const body = loopBody(graph, n.key);
    if (body.length === 0) issues.push({ level: "error", message: `Connect the steps to repeat to the “each” output of “${n.label}”.`, nodeKey: n.key });
    for (const k of body) {
      const b = byKey.get(k);
      if (b && !LOOP_BODY_ALLOWED.has(b.type)) {
        issues.push({ level: "error", message: `“${b.label}” can't run inside a loop (approvals, delays, employees and branching are not allowed in loops).`, nodeKey: b.key });
      }
      if (b && outgoing(graph, k).some((e) => !body.includes(e.target))) {
        issues.push({ level: "error", message: `Steps inside the loop “${n.label}” must not connect back to the main flow — use the loop's “done” output.`, nodeKey: b.key });
      }
    }
  }

  // Variables: references to unknown nodes or never-set variables.
  const RESERVED = new Set(["vars", "trigger", "nodes", "workflow", "company", "now", "loop", "item"]);
  for (const n of graph.nodes) {
    for (const path of referencedPaths(n.config)) {
      const [root, second] = path.split(".");
      if (root === "nodes" && second && !byKey.has(second)) {
        issues.push({ level: "error", message: `“${n.label}” uses {{${path}}}, but there is no step with id “${second}”.`, nodeKey: n.key });
      } else if ((root === "company" || root === "workflow") && !second) {
        const example = root === "company" ? "{{company.name}}" : "{{workflow.name}}";
        issues.push({
          level: "warning",
          message: `“${n.label}” uses {{${root}}}, which is your ${root === "company" ? "company profile" : "workflow details"}, not a trigger field. Use ${example}, or {{trigger.${root}}} for a trigger field named “${root}”.`,
          nodeKey: n.key,
        });
      } else if (!RESERVED.has(root) && !declaredVars.has(root) && !triggers.some((t) => ((t.config.inputFields as string[] | undefined) ?? []).some((f) => f.split(".")[0] === root))) {
        issues.push({ level: "warning", message: `“${n.label}” uses {{${path}}}. Make sure the trigger payload or an earlier step provides “${root}”.`, nodeKey: n.key });
      }
    }
  }

  // Human decision outputs that lead nowhere are fine, but a missing approved path is a mistake.
  for (const n of graph.nodes.filter((x) => x.type === "human.approval" || x.type === "human.review")) {
    if (outgoing(graph, n.key, "approved").length === 0) {
      issues.push({ level: "warning", message: `Nothing happens after “${n.label}” is approved.`, nodeKey: n.key });
    }
  }
  return issues;
}

export function graphFromRows(nodes: { key: string; type: string; label: string; config: unknown; positionX: number; positionY: number }[], edges: { key: string; source: string; target: string; sourceHandle: string | null; label: string | null }[]): WorkflowGraph {
  return {
    nodes: nodes.map((n) => ({ key: n.key, type: n.type as GraphNode["type"], label: n.label, config: (n.config as Record<string, unknown>) ?? {}, position: { x: n.positionX, y: n.positionY } })),
    edges: edges.map((e): GraphEdge => ({ key: e.key, source: e.source, target: e.target, sourceHandle: e.sourceHandle, label: e.label })),
  };
}
