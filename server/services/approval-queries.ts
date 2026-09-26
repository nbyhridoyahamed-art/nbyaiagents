import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ApprovalKind, ApprovalStatus, RiskLevel } from "@/lib/generated/prisma/enums";
import type { JsonSchema } from "@/lib/ai/types";
import { effectiveToolMeta, toolInputJsonSchema } from "@/server/tools/executor";

/** One editable field of a proposed action, derived from the tool's input schema. */
export interface EditableField {
  name: string;
  label: string;
  type: "string" | "text" | "number" | "boolean" | "select" | "json";
  required: boolean;
  options?: string[];
  description?: string;
}

export interface ApprovalCard {
  id: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  title: string;
  summary: string | null;
  reasons: string[];
  riskLevel: RiskLevel | null;
  toolKey: string | null;
  toolName: string | null;
  toolSimulated: boolean;
  capabilities: string[];
  isSimulation: boolean;
  question: string | null;
  response: string | null;
  proposedInput: Record<string, unknown> | null;
  editedInput: Record<string, unknown> | null;
  fields: EditableField[];
  createdAt: string;
  expiresAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  agent: { id: string; name: string; jobTitle: string; avatarColor: string } | null;
  task: { id: string; title: string; assigneeUserId: string | null } | null;
  agentRunId: string | null;
  workflowRun: { id: string; workflowId: string; workflowName: string; status: string } | null;
  /** Workflow-failure notices: nothing is paused, the person just needs to know. */
  isNotice: boolean;
}

export const ACTION_KINDS: ApprovalKind[] = ["TOOL_ACTION", "REVIEW"];
export const REQUEST_KINDS: ApprovalKind[] = ["QUESTION", "INPUT_REQUEST", "ESCALATION"];

const LONG_TEXT = /body|message|content|description|notes?|text|html|summary|comment/i;

function humanize(name: string) {
  const s = name.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Maps a JSON schema's top-level properties to form fields; anything nested is edited as JSON. */
export function fieldsFromSchema(schema: JsonSchema | null | undefined, sample: Record<string, unknown> | null): EditableField[] {
  const props = (schema?.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema?.required as string[] | undefined) ?? []);
  const names = [...new Set([...Object.keys(props), ...Object.keys(sample ?? {})])];
  return names.map((name) => {
    const p = props[name] ?? {};
    const rawType = Array.isArray(p.type) ? (p.type as string[]).find((t) => t !== "null") : (p.type as string | undefined);
    const sampleValue = sample?.[name];
    let type: EditableField["type"];
    if (Array.isArray(p.enum)) type = "select";
    else if (rawType === "number" || rawType === "integer") type = "number";
    else if (rawType === "boolean") type = "boolean";
    else if (rawType === "string" || (rawType === undefined && typeof sampleValue === "string")) {
      const long = LONG_TEXT.test(name) || Number(p.maxLength ?? 0) > 300 || (typeof sampleValue === "string" && (sampleValue.length > 120 || sampleValue.includes("\n")));
      type = long ? "text" : "string";
    } else type = "json";
    return {
      name,
      label: humanize(name),
      type,
      required: required.has(name),
      options: Array.isArray(p.enum) ? (p.enum as unknown[]).map(String) : undefined,
      description: typeof p.description === "string" ? p.description : undefined,
    };
  });
}

const include = {
  agent: { select: { id: true, name: true, jobTitle: true, avatarColor: true } },
} satisfies Prisma.ApprovalInclude;

type Row = Prisma.ApprovalGetPayload<{ include: typeof include }>;

async function toCards(orgId: string, rows: Row[]): Promise<ApprovalCard[]> {
  const toolKeys = [...new Set(rows.map((r) => r.toolKey).filter((k): k is string => !!k))];
  const taskIds = [...new Set(rows.map((r) => r.taskId).filter((k): k is string => !!k))];
  const wfrIds = [...new Set(rows.map((r) => r.workflowRunId).filter((k): k is string => !!k))];
  const userIds = [...new Set(rows.map((r) => r.decidedById).filter((k): k is string => !!k))];
  const [tools, tasks, wfRuns, users] = await Promise.all([
    toolKeys.length ? prisma.tool.findMany({ where: { orgId, key: { in: toolKeys } } }) : [],
    taskIds.length ? prisma.task.findMany({ where: { orgId, id: { in: taskIds } }, select: { id: true, title: true, assigneeUserId: true } }) : [],
    wfrIds.length ? prisma.workflowRun.findMany({ where: { orgId, id: { in: wfrIds } }, select: { id: true, status: true, workflow: { select: { id: true, name: true } } } }) : [],
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
  ]);

  return rows.map((r) => {
    const tool = r.toolKey ? tools.find((t) => t.key === r.toolKey) : undefined;
    const proposed = (r.proposedInput as Record<string, unknown> | null) ?? null;
    let fields: EditableField[] = [];
    if (r.kind === "TOOL_ACTION" && tool) fields = fieldsFromSchema(toolInputJsonSchema(tool), proposed);
    else if (r.kind === "REVIEW" && proposed && "content" in proposed) fields = [{ name: "content", label: "Content", type: "text", required: false }];
    const wfr = r.workflowRunId ? wfRuns.find((w) => w.id === r.workflowRunId) : undefined;
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      title: r.title,
      summary: r.summary,
      reasons: r.reasons,
      riskLevel: tool ? effectiveToolMeta(tool).riskLevel : r.riskLevel,
      toolKey: r.toolKey,
      toolName: r.toolName ?? tool?.name ?? null,
      toolSimulated: tool?.isSimulated ?? false,
      capabilities: tool ? effectiveToolMeta(tool).capabilities : [],
      isSimulation: r.isSimulation,
      question: r.question,
      response: r.response,
      proposedInput: proposed,
      editedInput: (r.editedInput as Record<string, unknown> | null) ?? null,
      fields,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt?.toISOString() ?? null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decidedBy: r.decidedById ? (users.find((u) => u.id === r.decidedById)?.name ?? "A teammate") : null,
      decisionNote: r.decisionNote,
      agent: r.agent,
      task: r.taskId ? (tasks.find((t) => t.id === r.taskId) ?? null) : null,
      agentRunId: r.agentRunId,
      workflowRun: wfr ? { id: wfr.id, workflowId: wfr.workflow.id, workflowName: wfr.workflow.name, status: wfr.status } : null,
      isNotice: r.kind === "ESCALATION" && !!r.workflowRunId && !r.agentRunId,
    };
  });
}

export interface ApprovalFilters {
  scope: "actions" | "requests";
  view: "pending" | "history";
  agentId?: string;
  risk?: RiskLevel;
  kind?: ApprovalKind;
}

export async function listApprovalCards(orgId: string, f: ApprovalFilters, take = 50) {
  const kinds = f.scope === "actions" ? ACTION_KINDS : REQUEST_KINDS;
  const where: Prisma.ApprovalWhereInput = {
    orgId,
    kind: f.kind && kinds.includes(f.kind) ? f.kind : { in: kinds },
    status: f.view === "pending" ? "PENDING" : { not: "PENDING" },
    ...(f.agentId ? { agentId: f.agentId } : {}),
    ...(f.risk ? { riskLevel: f.risk } : {}),
  };
  const rows = await prisma.approval.findMany({
    where,
    include,
    // Pending: oldest first (first in, first decided). History: most recent first.
    orderBy: f.view === "pending" ? [{ createdAt: "asc" }] : [{ decidedAt: "desc" }, { updatedAt: "desc" }],
    take,
  });
  return toCards(orgId, rows);
}

export async function getApprovalCard(orgId: string, id: string) {
  const row = await prisma.approval.findFirst({ where: { orgId, id }, include });
  if (!row) return null;
  return (await toCards(orgId, [row]))[0];
}

export async function approvalCounts(orgId: string) {
  const grouped = await prisma.approval.groupBy({ by: ["kind"], where: { orgId, status: "PENDING" }, _count: true });
  const sum = (kinds: ApprovalKind[]) => grouped.filter((g) => kinds.includes(g.kind)).reduce((s, g) => s + g._count, 0);
  return { actions: sum(ACTION_KINDS), requests: sum(REQUEST_KINDS) };
}
