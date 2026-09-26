import type { Condition, ConditionGroup } from "@/lib/workflows/types";

/**
 * Workflow variables (spec §38): `{{customer.name}}`, `{{lead.score}}`,
 * `{{agent.output}}`, `{{company.name}}`, `{{workflow.id}}`,
 * `{{nodes.<key>.<field>}}`, `{{trigger.<field>}}`.
 * No code execution — only dotted-path lookups.
 */

export interface ExpressionContext {
  vars: Record<string, unknown>;
  trigger: Record<string, unknown>;
  nodes: Record<string, unknown>;
  workflow: { id: string; name: string; runId: string };
  company: { name: string; timezone: string };
  item?: unknown;
  loop?: { index: number; item: unknown };
}

const TOKEN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.[\]-]*)\s*\}\}/g;

export function getPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Looks up a variable: reserved roots first, then vars, then trigger fields (shorthand). */
export function lookup(path: string, ctx: ExpressionContext): unknown {
  const [root] = path.split(".");
  const reserved: Record<string, unknown> = {
    vars: ctx.vars,
    trigger: ctx.trigger,
    nodes: ctx.nodes,
    workflow: ctx.workflow,
    company: ctx.company,
    loop: ctx.loop,
    now: new Date().toISOString(),
  };
  if (root in reserved) return root === "now" ? reserved.now : getPath(reserved, path);
  const fromVars = getPath(ctx.vars, path);
  if (fromVars !== undefined) return fromVars;
  if (ctx.loop && (root === "item" || root in (ctx.vars ?? {}))) return getPath({ item: ctx.loop.item, ...ctx.vars }, path);
  return getPath(ctx.trigger, path);
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Resolves templates in a string. A string that is exactly one token returns the raw value (type preserved). */
export function resolveTemplate(template: string, ctx: ExpressionContext): unknown {
  const exact = /^\s*\{\{\s*([a-zA-Z_][a-zA-Z0-9_.[\]-]*)\s*\}\}\s*$/.exec(template);
  if (exact) return lookup(exact[1], ctx);
  return template.replace(TOKEN, (_, path: string) => stringify(lookup(path, ctx)));
}

export function resolveText(template: string, ctx: ExpressionContext): string {
  return stringify(resolveTemplate(template, ctx));
}

/** Deeply resolves templates inside objects/arrays (e.g. tool inputs). */
export function resolveDeep(value: unknown, ctx: ExpressionContext): unknown {
  if (typeof value === "string") return resolveTemplate(value, ctx);
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, ctx));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveDeep(v, ctx)]));
  return value;
}

/** Every `{{path}}` used in a value — for validation. */
export function referencedPaths(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") for (const m of v.matchAll(TOKEN)) out.push(m[1]);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

export function evaluateCondition(c: Condition, ctx: ExpressionContext): boolean {
  const left = resolveTemplate(c.left, ctx);
  const right = resolveTemplate(c.right ?? "", ctx);
  switch (c.op) {
    case "exists":
      return left !== undefined && left !== null && left !== "";
    case "not_exists":
      return left === undefined || left === null || left === "";
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toNumber(left);
      const b = toNumber(right);
      if (a === null || b === null) return false;
      return c.op === "gt" ? a > b : c.op === "gte" ? a >= b : c.op === "lt" ? a < b : a <= b;
    }
    case "eq": {
      const a = toNumber(left);
      const b = toNumber(right);
      if (a !== null && b !== null) return a === b;
      return stringify(left).toLowerCase() === stringify(right).toLowerCase();
    }
    case "neq":
      return !evaluateCondition({ ...c, op: "eq" }, ctx);
    case "contains":
      return Array.isArray(left) ? left.map(stringify).includes(stringify(right)) : stringify(left).toLowerCase().includes(stringify(right).toLowerCase());
    case "not_contains":
      return !evaluateCondition({ ...c, op: "contains" }, ctx);
    case "in":
      return stringify(right)
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .includes(stringify(left).toLowerCase());
  }
}

export function evaluateGroup(group: ConditionGroup, ctx: ExpressionContext): boolean {
  const results = group.conditions.map((c) => evaluateCondition(c, ctx));
  return group.mode === "any" ? results.some(Boolean) : results.every(Boolean);
}

export function describeConditionGroup(group: ConditionGroup): string {
  const ops: Record<string, string> = { eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤", contains: "contains", not_contains: "does not contain", exists: "is set", not_exists: "is empty", in: "is one of" };
  return group.conditions.map((c) => `${c.left} ${ops[c.op]} ${["exists", "not_exists"].includes(c.op) ? "" : c.right}`.trim()).join(group.mode === "any" ? " OR " : " AND ");
}
