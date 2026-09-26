"use client";

import { useState } from "react";
import { Loader2, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormError } from "@/components/forms/field";
import { ConfirmButton } from "@/components/common/confirm-button";
import { useAction } from "@/hooks/use-action";
import { CAPABILITIES, describeEnforcement, type Capability, type PolicyEnforcement } from "@/lib/policies/types";
import { deletePolicyAction, savePolicyAction, togglePolicyAction } from "../actions";
import { ScopePicker, type Scope } from "./scope-picker";

export interface PolicyRow {
  id: string;
  name: string;
  rule: string;
  scope: Scope;
  scopeLabel: string;
  departmentId: string | null;
  agentId: string | null;
  enforcement: PolicyEnforcement | null;
  enabled: boolean;
}

type EnforcementChoice = "none" | "deny_capability" | "require_approval_capability" | "max_risk";

export function PoliciesView({
  policies,
  canManage,
  departments,
  agents,
}: {
  policies: PolicyRow[];
  canManage: boolean;
  departments: { id: string; name: string }[];
  agents: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState<PolicyRow | "new" | null>(null);
  const toggle = useAction(togglePolicyAction);
  const remove = useAction(deletePolicyAction, { success: "Policy deleted." });

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-section-title">Company AI policy</h2>
          <p className="text-[13px] text-text-secondary">
            Rules every AI employee follows. <strong className="font-medium">Runtime-enforced</strong> rules are checked in code
            before every action; guidance rules are given to the AI as instructions.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden /> Add policy
          </Button>
        )}
      </div>
      <ul className="grid gap-3">
        {policies.map((p) => (
          <li key={p.id} className="flex gap-4 rounded-xl border bg-surface p-4 shadow-card">
            <ShieldCheck className={p.enforcement ? "mt-0.5 size-5 shrink-0 text-brand" : "mt-0.5 size-5 shrink-0 text-text-muted"} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[14px] font-semibold">{p.name}</p>
                <Badge variant="outline">{p.scopeLabel}</Badge>
                {p.enforcement ? (
                  <Badge className="bg-brand-soft text-brand-hover">Runtime-enforced</Badge>
                ) : (
                  <Badge variant="secondary">Guidance</Badge>
                )}
                {!p.enabled && <Badge variant="secondary">Disabled</Badge>}
              </div>
              <p className="mt-1 text-[13px] text-text-secondary">{p.rule}</p>
              <p className="mt-1 text-xs text-text-muted">{describeEnforcement(p.enforcement)}</p>
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
                  description="AI employees will stop following this rule immediately."
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
      {editing && (
        <PolicyDialog
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

function PolicyDialog({
  initial,
  departments,
  agents,
  onClose,
}: {
  initial: PolicyRow | null;
  departments: { id: string; name: string }[];
  agents: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [rule, setRule] = useState(initial?.rule ?? "");
  const [scope, setScope] = useState({ scope: initial?.scope ?? ("ORGANIZATION" as Scope), departmentId: initial?.departmentId ?? null, agentId: initial?.agentId ?? null });
  const [kind, setKind] = useState<EnforcementChoice>(initial?.enforcement?.type === "deny_tool" ? "none" : (initial?.enforcement?.type ?? "none"));
  const [capability, setCapability] = useState<Capability>(
    initial?.enforcement && "capability" in initial.enforcement ? initial.enforcement.capability : "external_communication",
  );
  const [risk, setRisk] = useState(initial?.enforcement?.type === "max_risk" ? initial.enforcement.risk : "MEDIUM");
  const save = useAction(savePolicyAction, { success: "Policy saved.", onSuccess: onClose });

  const enforcement: PolicyEnforcement | null =
    kind === "none" ? null : kind === "max_risk" ? { type: "max_risk", risk } : { type: kind, capability };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit policy" : "New policy"}</DialogTitle>
          <DialogDescription>Lower layers (departments, employees, workflows, tasks) can never override a company policy.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run({ id: initial?.id, name, rule, ...scope, enforcement, enabled: initial?.enabled ?? true });
          }}
        >
          <FormError message={save.error && !Object.keys(save.fieldErrors).length ? save.error : null} />
          <Field label="Name" name="name" value={name} onChange={(e) => setName(e.target.value)} error={save.fieldErrors.name} maxLength={80} />
          <Field label="Rule" name="rule" multiline rows={3} defaultValue={rule} error={save.fieldErrors.rule} onChange={(e) => setRule(e.target.value)} />
          <ScopePicker {...scope} departments={departments} agents={agents} onChange={setScope} />
          <div className="grid gap-1.5">
            <Label className="text-[13px]">Enforcement</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as EnforcementChoice)}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Guidance only (instruction to the AI)</SelectItem>
                <SelectItem value="deny_capability">Block a type of action</SelectItem>
                <SelectItem value="require_approval_capability">Require approval for a type of action</SelectItem>
                <SelectItem value="max_risk">Block actions above a risk level</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(kind === "deny_capability" || kind === "require_approval_capability") && (
            <div className="grid gap-1.5">
              <Label className="text-[13px]">Type of action</Label>
              <Select value={capability} onValueChange={(v) => setCapability(v as Capability)}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CAPABILITIES) as Capability[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {CAPABILITIES[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {kind === "max_risk" && (
            <div className="grid gap-1.5">
              <Label className="text-[13px]">Highest allowed risk</Label>
              <Select value={risk} onValueChange={(v) => setRisk(v as typeof risk)}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <p className="text-xs text-text-muted">{describeEnforcement(enforcement)}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.pending}>
              {save.pending && <Loader2 className="animate-spin" aria-hidden />}
              Save policy
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
