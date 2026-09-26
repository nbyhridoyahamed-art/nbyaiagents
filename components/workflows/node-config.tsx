"use client";

import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RiskBadge, SimulatedBadge } from "@/components/tools/risk-badge";
import { nodeMeta, type Condition, type ConditionGroup, type NodeType } from "@/lib/workflows/types";
import type { OutputField, OutputSpec } from "@/lib/ai/output-spec";
import { SCHEDULE_PRESETS, describeCron } from "@/lib/workflows/schedule";
import type { EditorOptions } from "./editor-types";

type Config = Record<string, unknown>;

export interface NodeConfigProps {
  nodeKey: string;
  type: NodeType;
  label: string;
  config: Config;
  options: EditorOptions;
  variables: string[];
  readOnly: boolean;
  onChange: (patch: { label?: string; config?: Config }) => void;
  onDelete: () => void;
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[12.5px] font-medium">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

function TemplateInput({ value, onChange, multiline, placeholder, disabled }: { value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string; disabled?: boolean }) {
  return multiline ? (
    <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} placeholder={placeholder} disabled={disabled} className="font-mono text-[12px]" />
  ) : (
    <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} className="h-9 font-mono text-[12px]" />
  );
}

function StringList({ items, onChange, placeholder, disabled }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; disabled?: boolean }) {
  return (
    <div className="grid gap-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex gap-1.5">
          <Input className="h-8 text-[12.5px]" value={it} disabled={disabled} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`${placeholder} ${i + 1}`} />
          <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || items.length <= 1} onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove">
            <X aria-hidden />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="xs" className="justify-self-start" disabled={disabled} onClick={() => onChange([...items, ""])}>
        <Plus aria-hidden /> Add
      </Button>
    </div>
  );
}

const OPS: { value: Condition["op"]; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "doesn't contain" },
  { value: "exists", label: "is set" },
  { value: "not_exists", label: "is empty" },
  { value: "in", label: "is one of" },
];

/** Visual condition builder (spec §39): IF {{lead.score}} ≥ 80 … */
export function ConditionEditor({ group, onChange, disabled }: { group: ConditionGroup; onChange: (g: ConditionGroup) => void; disabled?: boolean }) {
  const set = (i: number, patch: Partial<Condition>) => onChange({ ...group, conditions: group.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <div className="grid gap-2 rounded-lg border bg-background p-2.5">
      {group.conditions.map((c, i) => (
        <div key={i} className="grid gap-1.5">
          {i > 0 && (
            <Select value={group.mode} onValueChange={(m) => onChange({ ...group, mode: m as "all" | "any" })} disabled={disabled}>
              <SelectTrigger className="h-7 w-20 text-xs" aria-label="Combine conditions">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">AND</SelectItem>
                <SelectItem value="any">OR</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Input className="h-8 font-mono text-[12px]" value={c.left} placeholder="{{lead.score}}" disabled={disabled} onChange={(e) => set(i, { left: e.target.value })} aria-label="Value to check" />
          <div className="flex gap-1.5">
            <Select value={c.op} onValueChange={(op) => set(i, { op: op as Condition["op"] })} disabled={disabled}>
              <SelectTrigger className="h-8 w-32 text-xs" aria-label="Operator">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!["exists", "not_exists"].includes(c.op) && (
              <Input className="h-8 flex-1 font-mono text-[12px]" value={c.right} placeholder="80" disabled={disabled} onChange={(e) => set(i, { right: e.target.value })} aria-label="Compare to" />
            )}
            <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || group.conditions.length <= 1} onClick={() => onChange({ ...group, conditions: group.conditions.filter((_, j) => j !== i) })} aria-label="Remove condition">
              <X aria-hidden />
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="xs" className="justify-self-start" disabled={disabled} onClick={() => onChange({ ...group, conditions: [...group.conditions, { left: "", op: "eq", right: "" }] })}>
        <Plus aria-hidden /> Condition
      </Button>
    </div>
  );
}

/** Structured output fields (spec §51) — validated after every AI response. */
export function OutputSpecEditor({ spec, onChange, disabled }: { spec: OutputSpec | undefined; onChange: (s: OutputSpec | undefined) => void; disabled?: boolean }) {
  const fields = spec?.fields ?? [];
  const setField = (i: number, patch: Partial<OutputField>) => onChange({ name: spec?.name ?? "result", fields: fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  return (
    <div className="grid gap-2">
      {fields.map((f, i) => (
        <div key={i} className="grid gap-1.5 rounded-lg border bg-background p-2">
          <div className="flex gap-1.5">
            <Input className="h-8 font-mono text-[12px]" value={f.name} disabled={disabled} placeholder="lead_score" onChange={(e) => setField(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") })} aria-label="Field name" />
            <Select value={f.type} onValueChange={(t) => setField(i, { type: t as OutputField["type"] })} disabled={disabled}>
              <SelectTrigger className="h-8 w-32 text-xs" aria-label="Field type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="string">Text</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="integer">Whole number</SelectItem>
                <SelectItem value="boolean">Yes / no</SelectItem>
                <SelectItem value="string_array">List of text</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} onClick={() => onChange(fields.length > 1 ? { name: spec?.name ?? "result", fields: fields.filter((_, j) => j !== i) } : undefined)} aria-label="Remove field">
              <X aria-hidden />
            </Button>
          </div>
          <Input className="h-8 text-[12px]" value={f.description} disabled={disabled} placeholder="What this field means" onChange={(e) => setField(i, { description: e.target.value })} aria-label="Field description" />
          {f.type === "string" && (
            <Input
              className="h-8 text-[12px]"
              value={(f.enum ?? []).join(", ")}
              disabled={disabled}
              placeholder="Allowed values (optional, comma-separated)"
              onChange={(e) => setField(i, { enum: e.target.value ? e.target.value.split(",").map((s) => s.trim()).filter(Boolean) : undefined })}
              aria-label="Allowed values"
            />
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="justify-self-start"
        disabled={disabled}
        onClick={() => onChange({ name: spec?.name ?? "result", fields: [...fields, { name: `field_${fields.length + 1}`, type: "string", description: "", required: true }] })}
      >
        <Plus aria-hidden /> {fields.length ? "Add field" : "Return structured fields"}
      </Button>
    </div>
  );
}

function AgentSelect({ value, options, onChange, disabled }: { value: string; options: EditorOptions; onChange: (id: string) => void; disabled?: boolean }) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-9 w-full" aria-label="AI employee">
        <SelectValue placeholder="Choose an employee" />
      </SelectTrigger>
      <SelectContent>
        {options.agents.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name} · {a.jobTitle}
            {!a.published ? " (draft)" : ""}
            {a.paused ? " (paused)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function NodeConfigPanel({ nodeKey, type, label, config, options, variables, readOnly, onChange, onDelete }: NodeConfigProps) {
  const meta = nodeMeta(type);
  const c = config as Record<string, never>;
  const set = (k: string, v: unknown) => onChange({ config: { ...config, [k]: v } });
  const str = (k: string) => (typeof config[k] === "string" ? (config[k] as string) : "");
  const ro = readOnly;
  const aiModelHint = "Uses your best configured AI model (or the offline demo model).";

  return (
    <div className="grid gap-4">
      <div>
        <p className="text-eyebrow text-text-muted">{meta?.label}</p>
        <p className="text-xs text-text-muted">{meta?.description}</p>
      </div>
      <FieldRow label="Step name">
        <Input className="h-9" value={label} disabled={ro} onChange={(e) => onChange({ label: e.target.value })} maxLength={80} />
      </FieldRow>

      {type === "trigger.manual" && (
        <FieldRow label="Expected inputs" hint="Fields you'll provide when running it, e.g. lead.email. Use them as {{lead.email}}.">
          <StringList items={(c.inputFields as string[]) ?? []} onChange={(v) => set("inputFields", v)} placeholder="Input" disabled={ro} />
        </FieldRow>
      )}
      {type === "trigger.schedule" && (
        <>
          <FieldRow label="Schedule" hint={describeCron(str("cron"))}>
            <Select value={SCHEDULE_PRESETS.find((p) => p.cron === str("cron"))?.key ?? "custom"} onValueChange={(k) => k !== "custom" && set("cron", SCHEDULE_PRESETS.find((p) => p.key === k)!.cron)} disabled={ro}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCHEDULE_PRESETS.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Cron expression" hint="Runs in your company timezone unless you set one below.">
            <TemplateInput value={str("cron")} onChange={(v) => set("cron", v)} disabled={ro} placeholder="0 8 * * 1-5" />
          </FieldRow>
        </>
      )}
      {type === "trigger.webhook" && (
        <div className="flex items-center justify-between rounded-lg border p-3">
          <span className="text-[12.5px]">Require an HMAC signature</span>
          <Switch checked={c.requireSignature !== false} onCheckedChange={(v) => set("requireSignature", v)} disabled={ro} aria-label="Require signature" />
        </div>
      )}
      {type === "trigger.event" && (
        <FieldRow label="Event" hint="Fires when a connected integration reports this event. The payload is available as {{lead}} or {{email}}.">
          <Select value={str("event")} onValueChange={(v) => set("event", v)} disabled={ro}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="crm.lead.created">New CRM lead</SelectItem>
              <SelectItem value="email.received">New email</SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>
      )}

      {(type === "ai.prompt" || type === "ai.analyze" || type === "ai.generate" || type === "ai.summarize") && (
        <>
          <FieldRow label="Instructions" hint={aiModelHint}>
            <TemplateInput multiline value={str("prompt")} onChange={(v) => set("prompt", v)} disabled={ro} placeholder="Write a short first email to {{lead.name}} about…" />
          </FieldRow>
          {type === "ai.summarize" && (
            <FieldRow label="Text to summarize">
              <TemplateInput multiline value={str("input")} onChange={(v) => set("input", v)} disabled={ro} placeholder="{{nodes.research.summary}}" />
            </FieldRow>
          )}
          <FieldRow label="Structured output (optional)">
            <OutputSpecEditor spec={c.outputSpec as OutputSpec | undefined} onChange={(s) => set("outputSpec", s)} disabled={ro} />
          </FieldRow>
        </>
      )}
      {type === "ai.classify" && (
        <>
          <FieldRow label="Input">
            <TemplateInput multiline value={str("input")} onChange={(v) => set("input", v)} disabled={ro} placeholder="{{email.body}}" />
          </FieldRow>
          <FieldRow label="Categories" hint="Output: {{nodes.<id>.category}}, confidence and reason.">
            <StringList items={(c.categories as string[]) ?? []} onChange={(v) => set("categories", v)} placeholder="Category" disabled={ro} />
          </FieldRow>
          <FieldRow label="Extra guidance (optional)">
            <TemplateInput multiline value={str("instructions")} onChange={(v) => set("instructions", v)} disabled={ro} />
          </FieldRow>
        </>
      )}
      {type === "ai.extract" && (
        <>
          <FieldRow label="Input">
            <TemplateInput multiline value={str("input")} onChange={(v) => set("input", v)} disabled={ro} placeholder="{{lead.message}}" />
          </FieldRow>
          <FieldRow label="Fields to extract">
            <OutputSpecEditor spec={c.outputSpec as OutputSpec | undefined} onChange={(s) => s && set("outputSpec", s)} disabled={ro} />
          </FieldRow>
        </>
      )}
      {type === "ai.decision" && (
        <>
          <FieldRow label="Question">
            <TemplateInput multiline value={str("question")} onChange={(v) => set("question", v)} disabled={ro} placeholder="Should we follow up with {{lead.company}} now?" />
          </FieldRow>
          <FieldRow label="Options" hint="Branch on {{nodes.<id>.decision}} with an If or Switch step.">
            <StringList items={(c.options as string[]) ?? []} onChange={(v) => set("options", v)} placeholder="Option" disabled={ro} />
          </FieldRow>
        </>
      )}
      {(type === "ai.research" || type === "agent.run") && (
        <>
          <FieldRow label="AI employee" hint="Their knowledge, tools and permissions apply. Work shows up as a task.">
            <AgentSelect value={str("agentId")} options={options} onChange={(v) => set("agentId", v)} disabled={ro} />
          </FieldRow>
          <FieldRow label={type === "ai.research" ? "Research topic" : "Instructions"}>
            <TemplateInput
              multiline
              value={str(type === "ai.research" ? "topic" : "instructions")}
              onChange={(v) => set(type === "ai.research" ? "topic" : "instructions", v)}
              disabled={ro}
              placeholder={type === "ai.research" ? "{{lead.company}} — size, industry, recent news" : "Qualify {{lead.name}} and draft a first email."}
            />
          </FieldRow>
          {type === "agent.run" && (
            <FieldRow label="Structured output (optional)">
              <OutputSpecEditor spec={c.outputSpec as OutputSpec | undefined} onChange={(s) => set("outputSpec", s)} disabled={ro} />
            </FieldRow>
          )}
        </>
      )}
      {type === "tool.call" && <ToolConfig config={config} options={options} onChange={(cfg) => onChange({ config: cfg })} disabled={ro} />}

      {(type === "logic.if" || type === "logic.filter") && (
        <FieldRow label={type === "logic.if" ? "Condition (Yes / No outputs)" : "Continue only if"}>
          <ConditionEditor group={c.condition as ConditionGroup} onChange={(g) => set("condition", g)} disabled={ro} />
        </FieldRow>
      )}
      {type === "logic.switch" && (
        <FieldRow label="Cases" hint="First matching case wins; otherwise “Default”.">
          <div className="grid gap-3">
            {((c.cases as { handle: string; label: string; condition: ConditionGroup }[]) ?? []).map((cs, i, all) => (
              <div key={i} className="grid gap-1.5 rounded-lg border p-2">
                <div className="flex gap-1.5">
                  <Input className="h-8 text-[12.5px]" value={cs.label} disabled={ro} onChange={(e) => set("cases", all.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Case label" />
                  <Button type="button" variant="ghost" size="icon-sm" disabled={ro || all.length <= 1} onClick={() => set("cases", all.filter((_, j) => j !== i))} aria-label="Remove case">
                    <X aria-hidden />
                  </Button>
                </div>
                <ConditionEditor group={cs.condition} onChange={(g) => set("cases", all.map((x, j) => (j === i ? { ...x, condition: g } : x)))} disabled={ro} />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="justify-self-start"
              disabled={ro}
              onClick={() => {
                const all = (c.cases as { handle: string }[]) ?? [];
                set("cases", [...all, { handle: `case_${all.length + 1}_${Math.random().toString(36).slice(2, 5)}`, label: `Case ${all.length + 1}`, condition: { mode: "all", conditions: [{ left: "", op: "eq", right: "" }] } }]);
              }}
            >
              <Plus aria-hidden /> Case
            </Button>
          </div>
        </FieldRow>
      )}
      {type === "logic.loop" && (
        <>
          <FieldRow label="List to loop over" hint="Connect the steps to repeat to “Each”; continue from “Done”. Results: {{nodes.<id>.items}}.">
            <TemplateInput value={str("items")} onChange={(v) => set("items", v)} disabled={ro} placeholder="{{leads}}" />
          </FieldRow>
          <div className="grid grid-cols-2 gap-2">
            <FieldRow label="Item variable">
              <Input className="h-9 font-mono text-[12px]" value={str("itemVar")} disabled={ro} onChange={(e) => set("itemVar", e.target.value)} />
            </FieldRow>
            <FieldRow label="Max items">
              <Input className="h-9" type="number" min={1} max={100} value={String(c.maxItems ?? 25)} disabled={ro} onChange={(e) => set("maxItems", Number(e.target.value))} />
            </FieldRow>
          </div>
        </>
      )}
      {type === "logic.delay" && (
        <FieldRow label="Wait (minutes)" hint="Runs in the background — no browser needed.">
          <Input className="h-9" type="number" min={1} value={String(Math.round(Number(c.seconds ?? 60) / 60))} disabled={ro} onChange={(e) => set("seconds", Math.max(60, Number(e.target.value) * 60))} />
        </FieldRow>
      )}

      {type === "human.approval" && (
        <>
          <FieldRow label="What needs approval?">
            <TemplateInput value={str("title")} onChange={(v) => set("title", v)} disabled={ro} placeholder="Approve outreach to {{lead.company}}" />
          </FieldRow>
          <FieldRow label="Details shown to the approver">
            <TemplateInput multiline value={str("details")} onChange={(v) => set("details", v)} disabled={ro} />
          </FieldRow>
        </>
      )}
      {type === "human.review" && (
        <>
          <FieldRow label="Title">
            <TemplateInput value={str("title")} onChange={(v) => set("title", v)} disabled={ro} placeholder="Review the blog post" />
          </FieldRow>
          <FieldRow label="Content to review (the reviewer can edit it)" hint="Edited version: {{nodes.<id>.content}}">
            <TemplateInput multiline value={str("content")} onChange={(v) => set("content", v)} disabled={ro} placeholder="{{draft.text}}" />
          </FieldRow>
        </>
      )}
      {type === "human.input" && (
        <FieldRow label="Question for a human" hint="Answer: {{nodes.<id>.answer}}">
          <TemplateInput multiline value={str("question")} onChange={(v) => set("question", v)} disabled={ro} />
        </FieldRow>
      )}

      {type === "data.set" && (
        <FieldRow label="Variables">
          <div className="grid gap-1.5">
            {((c.assignments as { name: string; value: string }[]) ?? []).map((a, i, all) => (
              <div key={i} className="flex gap-1.5">
                <Input className="h-8 w-28 font-mono text-[12px]" value={a.name} disabled={ro} placeholder="name" onChange={(e) => set("assignments", all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Variable name" />
                <Input className="h-8 flex-1 font-mono text-[12px]" value={a.value} disabled={ro} placeholder="{{lead.email}}" onChange={(e) => set("assignments", all.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} aria-label="Value" />
                <Button type="button" variant="ghost" size="icon-sm" disabled={ro || all.length <= 1} onClick={() => set("assignments", all.filter((_, j) => j !== i))} aria-label="Remove">
                  <X aria-hidden />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="xs" className="justify-self-start" disabled={ro} onClick={() => set("assignments", [...((c.assignments as unknown[]) ?? []), { name: "", value: "" }])}>
              <Plus aria-hidden /> Variable
            </Button>
          </div>
        </FieldRow>
      )}
      {type === "data.transform" && (
        <FieldRow label="Output template (JSON)" hint="Any {{variable}} inside strings is filled in.">
          <JsonEditor value={c.template as Record<string, unknown>} onChange={(v) => set("template", v)} disabled={ro} />
        </FieldRow>
      )}
      {type === "data.parse_json" && (
        <FieldRow label="JSON text">
          <TemplateInput value={str("source")} onChange={(v) => set("source", v)} disabled={ro} placeholder="{{nodes.api.data}}" />
        </FieldRow>
      )}
      {type === "data.store" && (
        <div className="grid gap-2">
          <FieldRow label="Result name">
            <Input className="h-9 font-mono text-[12px]" value={str("key")} disabled={ro} onChange={(e) => set("key", e.target.value)} />
          </FieldRow>
          <FieldRow label="Value">
            <TemplateInput value={str("value")} onChange={(v) => set("value", v)} disabled={ro} />
          </FieldRow>
        </div>
      )}
      {type === "flow.end" && (
        <FieldRow label="Workflow output (optional)" hint="Defaults to all stored results.">
          <TemplateInput value={str("output")} onChange={(v) => set("output", v)} disabled={ro} />
        </FieldRow>
      )}

      {/* Common settings */}
      {!type.startsWith("trigger.") && !["logic.if", "logic.switch", "logic.filter", "logic.parallel", "logic.delay", "data.set", "data.store", "flow.end"].includes(type) && (
        <FieldRow label="Save output as variable (optional)" hint="e.g. “lead” → use {{lead.score}} later.">
          <Input className="h-9 font-mono text-[12px]" value={str("outputVar")} disabled={ro} placeholder="scored" onChange={(e) => set("outputVar", e.target.value || undefined)} />
        </FieldRow>
      )}
      {meta?.errorHandle && (
        <div className="grid gap-2 rounded-lg border p-3">
          <p className="text-[12.5px] font-medium">Retry &amp; errors</p>
          <div className="flex items-center justify-between gap-2 text-[12.5px]">
            <span>Attempts</span>
            <Input
              className="h-8 w-20"
              type="number"
              min={1}
              max={5}
              disabled={ro}
              value={String((c.retry as { maxAttempts?: number } | undefined)?.maxAttempts ?? 1)}
              onChange={(e) => set("retry", { maxAttempts: Math.min(5, Math.max(1, Number(e.target.value))), backoffSeconds: (c.retry as { backoffSeconds?: number } | undefined)?.backoffSeconds ?? 30 })}
              aria-label="Max attempts"
            />
          </div>
          <p className="text-[11px] text-text-muted">Only failures that are safe to retry are retried — actions that may have happened (e.g. a sent email) are never repeated automatically.</p>
          <div className="flex items-center justify-between gap-2 text-[12.5px]">
            <span>Continue if this step fails</span>
            <Switch checked={!!c.continueOnError} onCheckedChange={(v) => set("continueOnError", v || undefined)} disabled={ro} aria-label="Continue on error" />
          </div>
          <p className="text-[11px] text-text-muted">Or connect the “On error” output to handle failures.</p>
        </div>
      )}

      {variables.length > 0 && (
        <FieldRow label="Available variables" hint="Click to copy.">
          <div className="flex flex-wrap gap-1">
            {variables.map((v) => (
              <button
                key={v}
                type="button"
                className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text-secondary hover:bg-brand-soft hover:text-brand-hover"
                onClick={() => {
                  void navigator.clipboard.writeText(`{{${v}}}`);
                  toast.success(`Copied {{${v}}}`);
                }}
              >
                {`{{${v}}}`}
              </button>
            ))}
          </div>
        </FieldRow>
      )}

      <p className="font-mono text-[10.5px] text-text-muted">id: {nodeKey}</p>
      {!ro && (
        <Button variant="outline" className="text-danger" onClick={onDelete}>
          <Trash2 aria-hidden /> Delete step
        </Button>
      )}
    </div>
  );
}

function ToolConfig({ config, options, onChange, disabled }: { config: Config; options: EditorOptions; onChange: (c: Config) => void; disabled?: boolean }) {
  const toolKey = typeof config.toolKey === "string" ? config.toolKey : "";
  const tool = options.tools.find((t) => t.key === toolKey);
  const input = (config.input as Record<string, unknown>) ?? {};
  return (
    <>
      <FieldRow label="Tool">
        <Select value={toolKey || undefined} onValueChange={(k) => onChange({ ...config, toolKey: k, input: {} })} disabled={disabled}>
          <SelectTrigger className="h-9 w-full" aria-label="Tool">
            <SelectValue placeholder={options.tools.length ? "Choose a tool" : "No tools — connect an integration first"} />
          </SelectTrigger>
          <SelectContent>
            {options.tools.map((t) => (
              <SelectItem key={t.key} value={t.key} disabled={!t.enabled}>
                {t.name} {!t.enabled && "(disabled)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
      {tool && (
        <div className="flex flex-wrap gap-1.5">
          <RiskBadge risk={tool.riskLevel} />
          {tool.simulated && <SimulatedBadge />}
        </div>
      )}
      <FieldRow label="Act as employee (recommended)" hint="Their permissions apply. Without one, anything above low risk always needs approval.">
        <Select value={(config.agentId as string) || "none"} onValueChange={(v) => onChange({ ...config, agentId: v === "none" ? undefined : v })} disabled={disabled}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Workflow default</SelectItem>
            {options.agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name} · {a.jobTitle}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
      {tool && (
        <FieldRow label="Inputs" hint="Fixed values or {{variables}}.">
          <div className="grid gap-2">
            {tool.fields.map((f) => (
              <div key={f.name} className="grid gap-1">
                <Label className="text-[11.5px] text-text-secondary">
                  {f.name}
                  {f.required && <span className="text-danger"> *</span>} <span className="text-text-muted">({f.type})</span>
                </Label>
                <Input
                  className="h-8 font-mono text-[12px]"
                  value={typeof input[f.name] === "string" ? (input[f.name] as string) : input[f.name] === undefined ? "" : JSON.stringify(input[f.name])}
                  placeholder={f.description || `{{${f.name}}}`}
                  disabled={disabled}
                  onChange={(e) => {
                    const raw = e.target.value;
                    let value: unknown = raw;
                    if ((f.type === "number" || f.type === "integer") && raw && !raw.includes("{{") && !Number.isNaN(Number(raw))) value = Number(raw);
                    if (f.type === "boolean" && (raw === "true" || raw === "false")) value = raw === "true";
                    const next = { ...input };
                    if (raw === "") delete next[f.name];
                    else next[f.name] = value;
                    onChange({ ...config, input: next });
                  }}
                  aria-label={f.name}
                />
              </div>
            ))}
            {tool.fields.length === 0 && <p className="text-[11px] text-text-muted">This tool takes no inputs.</p>}
          </div>
        </FieldRow>
      )}
    </>
  );
}

function JsonEditor({ value, onChange, disabled }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; disabled?: boolean }) {
  return (
    <Textarea
      defaultValue={JSON.stringify(value ?? {}, null, 2)}
      rows={6}
      disabled={disabled}
      className="font-mono text-[12px]"
      onBlur={(e) => {
        try {
          const parsed = JSON.parse(e.target.value || "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) onChange(parsed);
          else toast.error("Enter a JSON object.");
        } catch {
          toast.error("That isn't valid JSON.");
        }
      }}
    />
  );
}
