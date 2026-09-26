"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, ExternalLink, FlaskConical, Hand, Loader2, Pencil, ShieldAlert, Workflow, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { RiskBadge, SimulatedBadge } from "@/components/tools/risk-badge";
import { useAction } from "@/hooks/use-action";
import { CAPABILITIES, type Capability } from "@/lib/policies/types";
import { cn } from "@/lib/utils";
import type { ApprovalCard as Card, EditableField } from "@/server/services/approval-queries";
import { decideApprovalAction } from "@/app/(app)/approvals/actions";

const EMAIL_FIELDS = ["to", "subject", "body"];

function display(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

/** Readable preview of what the employee wants to do (spec §31: "Sarah wants to send: To / Subject / Message"). */
function ActionPreview({ input, fields }: { input: Record<string, unknown>; fields: EditableField[] }) {
  const keys = fields.length ? fields.map((f) => f.name) : Object.keys(input);
  const label = (k: string) => (k === "body" ? "Message" : (fields.find((f) => f.name === k)?.label ?? k));
  const isEmail = EMAIL_FIELDS.every((k) => k in input);
  const ordered = isEmail ? [...EMAIL_FIELDS, ...keys.filter((k) => !EMAIL_FIELDS.includes(k))] : keys;
  return (
    <dl className="grid gap-3 rounded-lg border bg-background p-4 text-[13.5px]">
      {ordered
        .filter((k) => k in input)
        .map((k) => {
          const v = input[k];
          const long = typeof v === "string" && (v.length > 80 || v.includes("\n"));
          return (
            <div key={k} className={cn("grid gap-0.5", !long && "sm:grid-cols-[120px_1fr] sm:gap-3")}>
              <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">{label(k)}</dt>
              <dd className={cn("min-w-0 break-words", long ? "whitespace-pre-wrap leading-relaxed" : "font-medium", typeof v === "object" && "font-mono text-xs")}>{display(v)}</dd>
            </div>
          );
        })}
    </dl>
  );
}

function FieldEditor({ field, value, onChange, error }: { field: EditableField; value: unknown; onChange: (v: unknown) => void; error?: string }) {
  const id = `f-${field.name}`;
  let control;
  switch (field.type) {
    case "text":
      control = <Textarea id={id} className="min-h-32" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "number":
      control = <Input id={id} type="number" value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />;
      break;
    case "boolean":
      control = <Switch id={id} checked={!!value} onCheckedChange={onChange} />;
      break;
    case "select":
      control = (
        <Select value={value === undefined ? undefined : String(value)} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case "json":
      control = <Textarea id={id} className="min-h-24 font-mono text-xs" value={typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2)} onChange={(e) => onChange(e.target.value)} />;
      break;
    default:
      control = <Input id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-[13px]">
        {field.name === "body" ? "Message" : field.label}
        {field.required && <span className="text-danger"> *</span>}
      </Label>
      {control}
      {field.description && <p className="text-xs text-text-muted">{field.description}</p>}
      {error && <p className="text-xs text-danger-text">{error}</p>}
    </div>
  );
}

function verb(card: Card) {
  if (card.kind === "REVIEW") return "needs a review";
  const name = card.toolName ?? "take an action";
  return `wants to ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}

export function ApprovalCard({ card, canDecide, focused }: { card: Card; canDecide: boolean; focused?: boolean }) {
  const [mode, setMode] = useState<"view" | "edit" | "reject">("view");
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...(card.proposedInput ?? {}) }));
  const [note, setNote] = useState("");
  const [jsonError, setJsonError] = useState<Record<string, string>>({});
  const decide = useAction(decideApprovalAction, {
    success: (d) => (mode === "reject" ? "Rejected. The employee won't do it." : d.edited ? "Approved with your edits." : "Approved. The work continues."),
  });
  const pending = card.status === "PENDING";
  const input = card.editedInput ?? card.proposedInput ?? {};
  const who = card.agent?.name ?? (card.workflowRun ? "A workflow" : "An employee");

  function approve() {
    if (mode !== "edit") return void decide.run({ approvalId: card.id, decision: "APPROVED" });
    // Parse JSON fields before sending.
    const errors: Record<string, string> = {};
    const out: Record<string, unknown> = {};
    for (const f of card.fields) {
      const v = draft[f.name];
      if (f.type === "json" && typeof v === "string") {
        try {
          out[f.name] = JSON.parse(v);
        } catch {
          errors[f.name] = "Must be valid JSON.";
        }
      } else if (v !== undefined) out[f.name] = v;
    }
    setJsonError(errors);
    if (Object.keys(errors).length) return;
    void decide.run({ approvalId: card.id, decision: "APPROVED", editedInput: out });
  }

  return (
    <article
      id={`approval-${card.id}`}
      className={cn("scroll-mt-24 rounded-xl border bg-surface shadow-card transition-shadow", focused && "ring-2 ring-brand/60", pending && card.riskLevel === "CRITICAL" && "border-danger/40")}
      aria-labelledby={`approval-title-${card.id}`}
    >
      <header className="flex flex-wrap items-start gap-3 border-b px-5 py-4">
        {card.agent ? (
          <AgentAvatar name={card.agent.name} color={card.agent.avatarColor} size={40} />
        ) : (
          <span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand">
            <Workflow className="size-5" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-warning-text">{pending ? (card.kind === "REVIEW" ? "Review required" : "Approval required") : card.kind === "REVIEW" ? "Review" : "Approval"}</p>
          <h3 id={`approval-title-${card.id}`} className="text-[15px] font-semibold">
            {who} {verb(card)}
          </h3>
          <p className="mt-0.5 text-[12.5px] text-text-muted">
            {card.agent?.jobTitle ? `${card.agent.jobTitle} · ` : ""}
            {card.title !== card.toolName && !card.title.startsWith(who) ? `${card.title} · ` : ""}
            requested {formatDistanceToNow(new Date(card.createdAt), { addSuffix: true })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {card.riskLevel && <RiskBadge risk={card.riskLevel} />}
          {card.toolSimulated && <SimulatedBadge />}
          {card.isSimulation && (
            <span className="inline-flex items-center gap-1 rounded-md bg-ai-soft px-1.5 py-0.5 text-[11px] font-semibold text-ai">
              <FlaskConical className="size-3" aria-hidden /> Test run
            </span>
          )}
          {!pending && <DecisionBadge status={card.status} />}
        </div>
      </header>

      <div className="grid gap-4 px-5 py-4">
        {card.reasons.length > 0 && (
          <div className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[12.5px] text-warning-text">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <div>
              <span className="font-semibold">Why this needs you: </span>
              {card.reasons.join(" · ")}
            </div>
          </div>
        )}

        {mode === "edit" ? (
          <div className="grid gap-3 rounded-lg border border-brand/40 bg-brand-soft/30 p-4">
            <p className="text-[12.5px] text-text-secondary">Edit the action before approving. The edited version is what will run — the employee can&apos;t change it afterwards.</p>
            {card.fields.map((f) => (
              <FieldEditor key={f.name} field={f} value={draft[f.name]} onChange={(v) => setDraft((d) => ({ ...d, [f.name]: v }))} error={jsonError[f.name] ?? decide.fieldErrors[f.name]} />
            ))}
          </div>
        ) : card.kind === "REVIEW" && typeof input.content === "string" ? (
          <div className="whitespace-pre-wrap rounded-lg border bg-background p-4 text-[13.5px] leading-relaxed">{input.content || "—"}</div>
        ) : card.kind === "REVIEW" && typeof input.details === "string" ? (
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{input.details || "Approve or reject to continue the workflow."}</p>
        ) : Object.keys(input).length > 0 ? (
          <ActionPreview input={input} fields={card.fields} />
        ) : null}

        {card.capabilities.filter((c) => c !== "read_only").length > 0 && (
          <p className="text-xs text-text-muted">Involves: {card.capabilities.filter((c) => c !== "read_only").map((c) => CAPABILITIES[c as Capability] ?? c).join(", ")}</p>
        )}

        <ContextLinks card={card} />

        {!pending && (
          <p className="text-[12.5px] text-text-secondary">
            {card.status === "EXPIRED" ? "Expired without a decision" : card.status === "CANCELLED" ? "Cancelled" : `${card.status === "APPROVED" ? "Approved" : "Rejected"} by ${card.decidedBy ?? "a teammate"}`}
            {card.decidedAt && ` · ${formatDistanceToNow(new Date(card.decidedAt), { addSuffix: true })}`}
            {card.editedInput && card.status === "APPROVED" && " · with edits"}
            {card.decisionNote && <span className="block italic">“{card.decisionNote}”</span>}
          </p>
        )}

        {mode === "reject" && (
          <div className="grid gap-1.5">
            <Label htmlFor={`note-${card.id}`} className="text-[13px]">
              Tell {card.agent?.name ?? "the employee"} why (optional)
            </Label>
            <Textarea id={`note-${card.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Don't contact this lead until next quarter." maxLength={1000} />
          </div>
        )}
      </div>

      {pending && canDecide && (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
          {card.expiresAt && mode === "view" && <span className="mr-auto text-xs text-text-muted">Expires {formatDistanceToNow(new Date(card.expiresAt), { addSuffix: true })}</span>}
          {mode === "view" && (
            <>
              {card.fields.length > 0 && (
                <Button variant="outline" onClick={() => setMode("edit")} disabled={decide.pending}>
                  <Pencil aria-hidden /> Edit
                </Button>
              )}
              <Button variant="outline" onClick={() => setMode("reject")} disabled={decide.pending} className="text-danger-text">
                <X aria-hidden /> Reject
              </Button>
              <Button onClick={approve} disabled={decide.pending}>
                {decide.pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />} Approve
              </Button>
            </>
          )}
          {mode === "edit" && (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setMode("view");
                  setDraft({ ...(card.proposedInput ?? {}) });
                  setJsonError({});
                }}
                disabled={decide.pending}
              >
                Cancel edit
              </Button>
              <Button onClick={approve} disabled={decide.pending}>
                {decide.pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />} Approve with edits
              </Button>
            </>
          )}
          {mode === "reject" && (
            <>
              <Button variant="ghost" onClick={() => setMode("view")} disabled={decide.pending}>
                Back
              </Button>
              <Button variant="destructive" onClick={() => void decide.run({ approvalId: card.id, decision: "REJECTED", note: note.trim() || undefined })} disabled={decide.pending}>
                {decide.pending ? <Loader2 className="animate-spin" aria-hidden /> : <X aria-hidden />} Reject action
              </Button>
            </>
          )}
        </footer>
      )}
      {pending && !canDecide && (
        <footer className="flex items-center gap-2 border-t px-5 py-3 text-[12.5px] text-text-muted">
          <Hand className="size-3.5" aria-hidden /> An admin or manager needs to decide this.
        </footer>
      )}
    </article>
  );
}

function DecisionBadge({ status }: { status: Card["status"] }) {
  const map: Record<string, string> = {
    APPROVED: "bg-success-soft text-success-text",
    ANSWERED: "bg-success-soft text-success-text",
    REJECTED: "bg-danger-soft text-danger-text",
    EXPIRED: "bg-surface-2 text-text-muted",
    CANCELLED: "bg-surface-2 text-text-muted",
  };
  return <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold capitalize", map[status])}>{status.toLowerCase()}</span>;
}

export function ContextLinks({ card }: { card: Card }) {
  const links: { href: string; label: string }[] = [];
  if (card.task) links.push({ href: `/tasks/${card.task.id}`, label: `Task: ${card.task.title}` });
  if (card.workflowRun) links.push({ href: `/workflows/runs/${card.workflowRun.id}`, label: `Workflow: ${card.workflowRun.workflowName}` });
  if (card.agentRunId) links.push({ href: `/runs/${card.agentRunId}`, label: "View run details" });
  if (card.agent) links.push({ href: `/agents/${card.agent.id}`, label: card.agent.name });
  if (!links.length) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
      {links.map((l) => (
        <li key={l.href}>
          <Link href={l.href} className="inline-flex items-center gap-1 text-brand hover:underline">
            {l.label} <ExternalLink className="size-3" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
