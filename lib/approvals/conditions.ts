import { z } from "zod";
import type { RiskLevel } from "@/lib/generated/prisma/enums";

/**
 * Approval policy conditions: IF <all conditions match> THEN <effect>.
 * Evaluated at runtime against every proposed tool action.
 */
export const CONDITION_FIELDS = {
  action: { label: "Action (tool key)", type: "string", example: "mock_email.send_email" },
  capability: { label: "Capability", type: "list", example: "external_communication" },
  risk: { label: "Risk level", type: "risk", example: "HIGH" },
  recipient: { label: "Recipient", type: "recipient", example: "external" },
  recipient_count: { label: "Number of recipients", type: "number", example: "10" },
  amount: { label: "Amount", type: "number", example: "100" },
  agent: { label: "AI employee (ID)", type: "string", example: "agent_…" },
  department: { label: "Department (ID)", type: "string", example: "dept_…" },
  input: { label: "Input field (path)", type: "path", example: "subject" },
} as const;

export type ConditionField = keyof typeof CONDITION_FIELDS;

export const CONDITION_OPS = {
  eq: "equals",
  neq: "does not equal",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  includes: "includes",
  not_includes: "does not include",
  contains: "contains text",
} as const;

export type ConditionOp = keyof typeof CONDITION_OPS;

export const approvalConditionSchema = z.object({
  field: z.enum(Object.keys(CONDITION_FIELDS) as [ConditionField, ...ConditionField[]]),
  op: z.enum(Object.keys(CONDITION_OPS) as [ConditionOp, ...ConditionOp[]]),
  value: z.union([z.string().max(200), z.number()]),
  /** For field "input": dot path into the tool input, e.g. "customer.email". */
  path: z.string().max(100).optional(),
});

export type ApprovalCondition = z.infer<typeof approvalConditionSchema>;

export const approvalConditionsSchema = z.object({ all: z.array(approvalConditionSchema).min(1).max(10) });

export interface ActionContext {
  toolKey: string;
  capabilities: string[];
  risk: RiskLevel;
  input: Record<string, unknown>;
  agentId: string;
  departmentId: string | null;
  /** Email domains considered internal (the organization's own). */
  internalDomains: string[];
}

const RISK_ORDER: Record<RiskLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

const EMAIL_RE = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi;

/** All recipient email addresses found in common recipient fields of a tool input. */
export function extractRecipients(input: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const key of ["to", "cc", "bcc", "recipients", "email", "attendees"]) {
    const v = input[key];
    const values = Array.isArray(v) ? v : v != null ? [v] : [];
    for (const item of values) {
      const s = typeof item === "string" ? item : typeof item === "object" && item && "email" in item ? String((item as { email: unknown }).email) : "";
      for (const m of s.matchAll(EMAIL_RE)) out.add(m[0].toLowerCase());
    }
  }
  return [...out];
}

function resolveField(cond: ApprovalCondition, ctx: ActionContext): unknown {
  switch (cond.field) {
    case "action":
      return ctx.toolKey;
    case "capability":
      return ctx.capabilities;
    case "risk":
      return ctx.risk;
    case "recipient": {
      const recipients = extractRecipients(ctx.input);
      if (recipients.length === 0) return "none";
      const internal = new Set(ctx.internalDomains.map((d) => d.toLowerCase()));
      return recipients.some((r) => !internal.has(r.split("@")[1] ?? "")) ? "external" : "internal";
    }
    case "recipient_count":
      return extractRecipients(ctx.input).length;
    case "amount": {
      const v = ctx.input.amount ?? ctx.input.total ?? ctx.input.value;
      return typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : undefined;
    }
    case "agent":
      return ctx.agentId;
    case "department":
      return ctx.departmentId;
    case "input":
      return cond.path ? getPath(ctx.input, cond.path) : undefined;
  }
}

function compare(actual: unknown, op: ConditionOp, expected: string | number, field: ConditionField): boolean {
  if (actual === undefined || actual === null) return op === "neq" || op === "not_includes";
  if (field === "risk") {
    const a = RISK_ORDER[actual as RiskLevel] ?? 0;
    const e = RISK_ORDER[String(expected).toUpperCase() as RiskLevel] ?? 0;
    return numericCompare(a, op, e);
  }
  if (Array.isArray(actual)) {
    const has = actual.map(String).includes(String(expected));
    if (op === "includes" || op === "eq") return has;
    if (op === "not_includes" || op === "neq") return !has;
    return false;
  }
  if (typeof actual === "number" || (typeof expected === "number" && !Number.isNaN(Number(actual)))) {
    const a = Number(actual);
    const e = Number(expected);
    if (Number.isNaN(a) || Number.isNaN(e)) return false;
    return numericCompare(a, op, e);
  }
  const a = String(actual).toLowerCase();
  const e = String(expected).toLowerCase();
  switch (op) {
    case "eq":
      return a === e;
    case "neq":
      return a !== e;
    case "contains":
    case "includes":
      return a.includes(e);
    case "not_includes":
      return !a.includes(e);
    default:
      return false;
  }
}

function numericCompare(a: number, op: ConditionOp, e: number) {
  switch (op) {
    case "eq":
      return a === e;
    case "neq":
      return a !== e;
    case "gt":
      return a > e;
    case "gte":
      return a >= e;
    case "lt":
      return a < e;
    case "lte":
      return a <= e;
    default:
      return false;
  }
}

/** True when every condition matches the proposed action. */
export function conditionsMatch(conditions: ApprovalCondition[], ctx: ActionContext): boolean {
  if (conditions.length === 0) return false;
  return conditions.every((c) => compare(resolveField(c, ctx), c.op, c.value, c.field));
}

export function describeCondition(c: ApprovalCondition): string {
  const field = c.field === "input" ? `input.${c.path ?? "?"}` : CONDITION_FIELDS[c.field].label.toLowerCase();
  return `${field} ${CONDITION_OPS[c.op]} ${c.value}`;
}
