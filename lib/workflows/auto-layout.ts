import type { GraphEdge, GraphNode } from "@/lib/workflows/types";

/**
 * Left-to-right layered layout for generated graphs: each step sits one column
 * after its furthest predecessor; steps in the same column are stacked.
 */
export function autoLayout(nodes: Omit<GraphNode, "position">[], edges: Pick<GraphEdge, "source" | "target">[]): GraphNode[] {
  const level = new Map<string, number>();
  const incoming = (k: string) => edges.filter((e) => e.target === k).map((e) => e.source);
  const visit = (k: string, seen: Set<string>): number => {
    if (level.has(k)) return level.get(k)!;
    if (seen.has(k)) return 0; // cycle guard — validation reports cycles separately
    seen.add(k);
    const preds = incoming(k);
    const l = preds.length ? Math.max(...preds.map((p) => visit(p, seen))) + 1 : 0;
    level.set(k, l);
    return l;
  };
  for (const n of nodes) visit(n.key, new Set());
  const rows = new Map<number, number>();
  return nodes.map((n) => {
    const l = level.get(n.key) ?? 0;
    const row = rows.get(l) ?? 0;
    rows.set(l, row + 1);
    return { ...n, position: { x: l * 290, y: 120 + row * 150 } };
  });
}
