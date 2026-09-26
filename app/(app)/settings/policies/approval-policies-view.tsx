"use client";

import { useState } from "react";
import { GitBranch, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormError } from "@/components/forms/field";
import { ConfirmButton } from "@/components/common/confirm-button";
import { useAction } from "@/hooks/use-action";
import {
  CONDITION_FIELDS,
  CONDITION_OPS,
  describeCondition,
  type ApprovalCondition,
  type ConditionField,
  type ConditionOp,
} from "@/lib/approvals/conditions";
import { CAPABILITIES } from "@/lib/policies/types";
import { deleteApprovalPolicyAction, saveApprovalPolicyAction, toggleApprovalPolicyAction } from "../actions";
import { ScopePicker, type Scope } from "./scope-picker";

export interface ApprovalPolicyRow {
  id: string;
  name: string;
  description: string | null;
  scope: Scope;
  scopeLabel: string;
  departmentId: string | null;
  agentId: string | null;
  conditions: ApprovalCondition[];
  effect: "ALLOW" | "REQUIRE_APPROVAL" | "DENY";
  priority: number;
  enabled: boolean;
}

const OPS_FOR: Record<string, ConditionOp[]> = {
  string: ["eq", "neq", "contains"],
  list: ["includes", "not_includes"],
  risk: ["gte", "eq", "lte"],
  recipient: ["eq", "neq"],
  number: ["gt", "gte", "lt", "lte", "eq"],
  path: ["eq", "neq", "contains", "gt", "gte", "lt", "lte"],
};

export function ApprovalPoliciesView({
  policies,
  canManage,
  departments,
  agents,
}: {
  policies: ApprovalPolicyRow[];
  canManage: boolean;
  departments: { id: string; name: string }[];
  agents: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState<ApprovalPolicyRow | "new" | null>(null);
  const toggle = useAction(toggleApprovalPolicyAction);
  const remove = useAction(deleteApprovalPolicyAction, { success: "Rule deleted." });

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-section-title">Approval rules</h2>
          <p className="text-[13px] text-text-secondary">
            IF an action matches every condition, THEN it pauses for human approval (or is blocked). Checked at runtime.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden /> Add rule
          </Button>
        )}
      </div>
      {policies.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-surface p-6 text-center text-[13px] text-text-muted">No approval rules yet.</p>
      ) : (
        <ul className="grid gap-3">
          {policies.map((p) => (
            <li key={p.id} className="flex gap-4 rounded-xl border bg-surface p-4 shadow-card">
              <GitBranch className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[14px] font-semibold">{p.name}</p>
                  <Badge variant="outline">{p.scopeLabel}</Badge>
                  <Badge className={p.effect === "DENY" ? "bg-danger-soft text-danger-text" : "bg-warning-soft text-warning-text"}>
                    {p.effect === "DENY" ? "Blocks" : "Requires approval"}
                  </Badge>
                  {!p.enabled && <Badge variant="secondary">Disabled</Badge>}
                </div>
                <p className="mt-1.5 font-mono text-xs text-text-secondary">
                  IF {p.conditions.map(describeCondition).join(" AND ")} THEN {p.effect === "DENY" ? "block" : "require approval"}
                </p>
                {p.description && <p className="mt-1 text-[13px] text-text-muted">{p.description}</p>}
              </div>
              {canManage && (
                <div className="flex shrink-0 items-start gap-1">
                  <Switch
                    checked={p.enabled}
                    onCheckedChange={(v) => void toggle.run({ id: p.id, enabled: v })}
                    aria-label={`${p.enabled ? "Disable" : "Enable"} ${p.name}`}
                    className="mr-2 mt-1.5"
                  />
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                    <Pencil aria-hidden />
                  </Button>
                  <ConfirmButton
                    variant="ghost"
                    size="icon-sm"
                    destructive
                    title={`Delete "${p.name}"?`}
                    description="Matching actions will no longer pause for approval unless another rule applies."
                    confirmLabel="Delete"
                    onConfirm={() => remove.run(p.id)}
                  >
                    <Trash2 aria-hidden />
                    <span className="sr-only">Delete {p.name}</span>
                  </ConfirmButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <RuleDialog
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          departments={departments}
          agents={agents}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function RuleDialog({
  initial,
  departments,
  agents,
  onClose,
}: {
  initial: ApprovalPolicyRow | null;
  departments: { id: string; name: string }[];
  agents: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [scope, setScope] = useState({ scope: initial?.scope ?? ("ORGANIZATION" as Scope), departmentId: initial?.departmentId ?? null, agentId: initial?.agentId ?? null });
  const [effect, setEffect] = useState<"REQUIRE_APPROVAL" | "DENY">(initial?.effect === "DENY" ? "DENY" : "REQUIRE_APPROVAL");
  const [conditions, setConditions] = useState<ApprovalCondition[]>(
    initial?.conditions.length ? initial.conditions : [{ field: "capability", op: "includes", value: "external_communication" }],
  );
  const save = useAction(saveApprovalPolicyAction, { success: "Rule saved.", onSuccess: onClose });

  function update(i: number, patch: Partial<ApprovalCondition>) {
    setConditions((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit approval rule" : "New approval rule"}</DialogTitle>
          <DialogDescription>Build a condition. Every condition must match for the rule to apply.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run({
              id: initial?.id,
              name,
              description,
              ...scope,
              effect,
              conditions: conditions.map((c) => ({
                ...c,
                value: ["number"].includes(CONDITION_FIELDS[c.field].type) ? Number(c.value) : c.value,
              })),
              priority: initial?.priority,
              enabled: initial?.enabled ?? true,
            });
          }}
        >
          <FormError message={save.error} />
          <Field label="Name" name="name" value={name} onChange={(e) => setName(e.target.value)} error={save.fieldErrors.name} maxLength={80} />
          <Field label="Description (optional)" name="description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
          <ScopePicker {...scope} departments={departments} agents={agents} onChange={setScope} />

          <fieldset className="grid gap-2 rounded-xl border bg-background p-3">
            <legend className="px-1 text-[13px] font-semibold">Conditions</legend>
            {conditions.map((c, i) => {
              const type = CONDITION_FIELDS[c.field].type;
              return (
                <div key={i} className="grid gap-2 sm:grid-cols-[auto_1fr_1fr_1fr_auto] sm:items-center">
                  <span className="text-xs font-semibold text-text-muted">{i === 0 ? "IF" : "AND"}</span>
                  <Select
                    value={c.field}
                    onValueChange={(v) => {
                      const field = v as ConditionField;
                      update(i, { field, op: OPS_FOR[CONDITION_FIELDS[field].type][0], value: "", path: undefined });
                    }}
                  >
                    <SelectTrigger className="h-9 w-full" aria-label="Field">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(CONDITION_FIELDS) as ConditionField[]).map((f) => (
                        <SelectItem key={f} value={f}>
                          {CONDITION_FIELDS[f].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select key={`op-${c.field}`} value={c.op} onValueChange={(v) => update(i, { op: v as ConditionOp })}>
                    <SelectTrigger className="h-9 w-full" aria-label="Operator">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPS_FOR[type].map((op) => (
                        <SelectItem key={op} value={op}>
                          {CONDITION_OPS[op]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    {c.field === "input" && (
                      <Input className="h-9" placeholder="path" value={c.path ?? ""} onChange={(e) => update(i, { path: e.target.value })} aria-label="Input path" />
                    )}
                    {type === "list" ? (
                      <Select key={`val-${c.field}`} value={String(c.value)} onValueChange={(v) => update(i, { value: v })}>
                        <SelectTrigger className="h-9 w-full" aria-label="Value">
                          <SelectValue placeholder="Choose" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(CAPABILITIES).map(([k, label]) => (
                            <SelectItem key={k} value={k}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : type === "risk" ? (
                      <Select key={`val-${c.field}`} value={String(c.value)} onValueChange={(v) => update(i, { value: v })}>
                        <SelectTrigger className="h-9 w-full" aria-label="Value">
                          <SelectValue placeholder="Choose" />
                        </SelectTrigger>
                        <SelectContent>
                          {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((r) => (
                            <SelectItem key={r} value={r}>
                              {r.charAt(0) + r.slice(1).toLowerCase()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : type === "recipient" ? (
                      <Select key={`val-${c.field}`} value={String(c.value)} onValueChange={(v) => update(i, { value: v })}>
                        <SelectTrigger className="h-9 w-full" aria-label="Value">
                          <SelectValue placeholder="Choose" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="external">External</SelectItem>
                          <SelectItem value="internal">Internal</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        className="h-9"
                        type={type === "number" ? "number" : "text"}
                        placeholder={CONDITION_FIELDS[c.field].example}
                        value={String(c.value)}
                        onChange={(e) => update(i, { value: e.target.value })}
                        aria-label="Value"
                      />
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={conditions.length === 1}
                    onClick={() => setConditions((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label="Remove condition"
                  >
                    <X aria-hidden />
                  </Button>
                </div>
              );
            })}
            {conditions.length < 10 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-self-start"
                onClick={() => setConditions((prev) => [...prev, { field: "action", op: "eq", value: "" }])}
              >
                <Plus aria-hidden /> Add condition
              </Button>
            )}
          </fieldset>

          <div className="grid gap-1.5">
            <Label className="text-[13px]">Then</Label>
            <Select value={effect} onValueChange={(v) => setEffect(v as typeof effect)}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="REQUIRE_APPROVAL">Pause and require human approval</SelectItem>
                <SelectItem value="DENY">Block the action</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.pending}>
              {save.pending && <Loader2 className="animate-spin" aria-hidden />}
              Save rule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
