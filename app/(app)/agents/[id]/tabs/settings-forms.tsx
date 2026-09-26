"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/forms/field";
import { ListEditor } from "@/components/forms/list-editor";
import { AVATAR_COLORS, INSTRUCTION_SECTIONS, PERSONALITIES, type InstructionKey } from "@/lib/agents/schema";
import { PROVIDER_LABELS } from "@/lib/ai/models";
import type { ProviderKind } from "@/lib/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { updateAgentModelAction, updateAgentProfileAction, updateDelegatesAction, updateInstructionsAction } from "../../actions";

interface SettingsAgent {
  id: string;
  name: string;
  jobTitle: string;
  departmentId: string | null;
  description: string;
  avatarColor: string;
  mission: string;
  responsibilities: string[];
  goals: string[];
  kpis: string[];
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  personality: string;
  personalityNotes: string;
  instructions: Partial<Record<InstructionKey, string>>;
  model: { provider: ProviderKind; model: string; fallbackProvider: ProviderKind | null; fallbackModel: string | null; temperature: number; maxOutputTokens: number };
  limits: { maxStepsPerRun: number; maxToolCallsPerRun: number; maxTokensPerRun: number; maxCostPerRunUsd: number; monthlyBudgetUsd: number; canDelegate: boolean };
  delegateIds: string[];
}

export function AgentSettingsForms({
  agent,
  canEdit,
  focus,
  departments,
  providers,
  models,
  others,
}: {
  agent: SettingsAgent;
  canEdit: boolean;
  focus?: string;
  departments: { id: string; name: string }[];
  providers: { kind: ProviderKind; configured: boolean }[];
  models: { id: string; provider: ProviderKind; label: string; supportsTemperature: boolean }[];
  others: { id: string; name: string; jobTitle: string }[];
}) {
  useEffect(() => {
    if (focus) document.getElementById(focus)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus]);

  return (
    <div className="grid max-w-4xl gap-6">
      {!canEdit && <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-text-secondary">You have read-only access to this employee.</p>}
      <ProfileSection agent={agent} departments={departments} canEdit={canEdit} />
      <section id="instructions" className="scroll-mt-24">
        <InstructionsSection agent={agent} canEdit={canEdit} />
      </section>
      <section id="model" className="scroll-mt-24">
        <ModelSection agent={agent} providers={providers} models={models} canEdit={canEdit} />
      </section>
      <DelegationSection agent={agent} others={others} canEdit={canEdit} />
      <p className="text-xs text-text-muted">Changes are saved to the draft. Publish a new version to use them in live work.</p>
    </div>
  );
}

function Card({ title, description, children, footer }: { title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-surface shadow-card">
      <div className="p-5 sm:p-6">
        <h2 className="text-card-title">{title}</h2>
        {description && <p className="text-[13px] text-text-secondary">{description}</p>}
        <div className="mt-5 grid gap-4">{children}</div>
      </div>
      {footer && <div className="flex justify-end border-t px-5 py-3">{footer}</div>}
    </div>
  );
}

function SaveButton({ pending, disabled }: { pending: boolean; disabled?: boolean }) {
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending && <Loader2 className="animate-spin" aria-hidden />} Save
    </Button>
  );
}

function ProfileSection({ agent, departments, canEdit }: { agent: SettingsAgent; departments: { id: string; name: string }[]; canEdit: boolean }) {
  const [v, setV] = useState({
    name: agent.name,
    jobTitle: agent.jobTitle,
    departmentId: agent.departmentId,
    description: agent.description,
    avatarColor: agent.avatarColor,
    mission: agent.mission,
    responsibilities: agent.responsibilities,
    goals: agent.goals,
    kpis: agent.kpis,
    priority: agent.priority,
    personality: agent.personality,
    personalityNotes: agent.personalityNotes,
  });
  const save = useAction(updateAgentProfileAction, { success: "Profile saved." });
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((p) => ({ ...p, [k]: val }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save.run({ agentId: agent.id, profile: { ...v, personality: v.personality as never } });
      }}
    >
      <fieldset disabled={!canEdit} className="contents">
        <Card title="Identity, role & personality" footer={canEdit && <SaveButton pending={save.pending} />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" name="name" value={v.name} onChange={(e) => set("name", e.target.value)} error={save.fieldErrors["profile.name"]} />
            <Field label="Job title" name="jobTitle" value={v.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} error={save.fieldErrors["profile.jobTitle"]} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-[13px]">Department</Label>
              <Select value={v.departmentId ?? "none"} onValueChange={(val) => set("departmentId", val === "none" ? null : val)}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No department</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium">Avatar colour</legend>
              <div className="flex flex-wrap gap-2">
                {AVATAR_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={v.avatarColor === c}
                    aria-label={`Colour ${c}`}
                    onClick={() => set("avatarColor", c)}
                    className={cn("size-6 rounded-full ring-offset-2 ring-offset-surface", v.avatarColor === c && "ring-2 ring-foreground")}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </fieldset>
          </div>
          <Field label="Description" name="description" multiline rows={2} defaultValue={v.description} onChange={(e) => set("description", e.target.value)} />
          <Field label="Mission" name="mission" multiline rows={2} defaultValue={v.mission} onChange={(e) => set("mission", e.target.value)} />
          <div className="grid gap-4 md:grid-cols-3">
            <ListEditor label="Responsibilities" items={v.responsibilities} onChange={(x) => set("responsibilities", x)} />
            <ListEditor label="Goals" items={v.goals} onChange={(x) => set("goals", x)} />
            <ListEditor label="KPIs" items={v.kpis} onChange={(x) => set("kpis", x)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-[13px]">Personality</Label>
              <Select value={v.personality} onValueChange={(val) => set("personality", val)}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERSONALITIES.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.label} — {p.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[13px]">Priority</Label>
              <Select value={v.priority} onValueChange={(val) => set("priority", val as typeof v.priority)}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
                    <SelectItem key={p} value={p}>
                      {p.charAt(0) + p.slice(1).toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Field label="Custom style notes" name="personalityNotes" multiline rows={2} defaultValue={v.personalityNotes} onChange={(e) => set("personalityNotes", e.target.value)} />
        </Card>
      </fieldset>
    </form>
  );
}

function InstructionsSection({ agent, canEdit }: { agent: SettingsAgent; canEdit: boolean }) {
  const [instructions, setInstructions] = useState(agent.instructions);
  const save = useAction(updateInstructionsAction, { success: "Instructions saved." });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // Send every section so cleared sections are removed.
        const all = Object.fromEntries(INSTRUCTION_SECTIONS.map((s) => [s.key, instructions[s.key] ?? ""]));
        void save.run({ agentId: agent.id, instructions: all });
      }}
    >
      <fieldset disabled={!canEdit} className="contents">
        <Card
          title="Instructions"
          description="The employee's operating manual. Company policy, department policy and runtime permissions always take priority over these."
          footer={canEdit && <SaveButton pending={save.pending} />}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {INSTRUCTION_SECTIONS.map((s) => (
              <div key={s.key} className="grid gap-1.5">
                <Label htmlFor={`ins-${s.key}`} className="text-[13px]">
                  {s.label}
                </Label>
                <Textarea
                  id={`ins-${s.key}`}
                  rows={3}
                  value={instructions[s.key] ?? ""}
                  onChange={(e) => setInstructions((p) => ({ ...p, [s.key]: e.target.value }))}
                  placeholder={s.placeholder}
                  maxLength={4000}
                />
              </div>
            ))}
          </div>
        </Card>
      </fieldset>
    </form>
  );
}

function ModelSection({
  agent,
  providers,
  models,
  canEdit,
}: {
  agent: SettingsAgent;
  providers: { kind: ProviderKind; configured: boolean }[];
  models: { id: string; provider: ProviderKind; label: string; supportsTemperature: boolean }[];
  canEdit: boolean;
}) {
  const [model, setModel] = useState(agent.model);
  const [limits, setLimits] = useState(agent.limits);
  const save = useAction(updateAgentModelAction, { success: "Model & limits saved." });
  const selected = models.find((m) => m.id === model.model);
  const num = (k: keyof typeof limits) => (e: React.ChangeEvent<HTMLInputElement>) => setLimits((l) => ({ ...l, [k]: Number(e.target.value) }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save.run({ agentId: agent.id, model, limits });
      }}
    >
      <fieldset disabled={!canEdit} className="contents">
        <Card title="AI model & execution limits" description="Limits are enforced by the runtime on every run." footer={canEdit && <SaveButton pending={save.pending} />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <ProviderModelPicker label="Model" value={{ provider: model.provider, model: model.model }} providers={providers} models={models} onChange={(v) => setModel((m) => ({ ...m, ...v }))} />
            <ProviderModelPicker
              label="Fallback model (optional)"
              optional
              value={model.fallbackProvider ? { provider: model.fallbackProvider, model: model.fallbackModel ?? "" } : null}
              providers={providers}
              models={models}
              onChange={(v) => setModel((m) => ({ ...m, fallbackProvider: v?.provider ?? null, fallbackModel: v?.model ?? null }))}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Temperature"
              name="temperature"
              type="number"
              step={0.1}
              min={0}
              max={1}
              value={String(model.temperature)}
              onChange={(e) => setModel((m) => ({ ...m, temperature: Number(e.target.value) }))}
              hint={selected && !selected.supportsTemperature ? "Ignored: this model manages sampling itself." : "0 = consistent, 1 = creative."}
            />
            <Field label="Max output tokens per response" name="maxOutputTokens" type="number" min={256} max={64000} value={String(model.maxOutputTokens)} onChange={(e) => setModel((m) => ({ ...m, maxOutputTokens: Number(e.target.value) }))} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Max steps per run" name="maxStepsPerRun" type="number" min={1} max={50} value={String(limits.maxStepsPerRun)} onChange={num("maxStepsPerRun")} />
            <Field label="Max tool calls per run" name="maxToolCallsPerRun" type="number" min={0} max={50} value={String(limits.maxToolCallsPerRun)} onChange={num("maxToolCallsPerRun")} />
            <Field label="Max tokens per run" name="maxTokensPerRun" type="number" min={1000} value={String(limits.maxTokensPerRun)} onChange={num("maxTokensPerRun")} />
            <Field label="Max cost per run (USD)" name="maxCostPerRunUsd" type="number" step={0.1} min={0} value={String(limits.maxCostPerRunUsd)} onChange={num("maxCostPerRunUsd")} />
            <Field label="Monthly budget (USD)" name="monthlyBudgetUsd" type="number" min={0} value={String(limits.monthlyBudgetUsd)} onChange={num("monthlyBudgetUsd")} hint="Runs stop when estimated spend reaches this." />
          </div>
        </Card>
      </fieldset>
    </form>
  );
}

function ProviderModelPicker({
  label,
  value,
  providers,
  models,
  onChange,
  optional,
}: {
  label: string;
  value: { provider: ProviderKind; model: string } | null;
  providers: { kind: ProviderKind; configured: boolean }[];
  models: { id: string; provider: ProviderKind; label: string }[];
  onChange: (v: { provider: ProviderKind; model: string } | null) => void;
  optional?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[13px]">{label}</Label>
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={value?.provider ?? "none"}
          onValueChange={(v) => {
            if (v === "none") return onChange(null);
            const provider = v as ProviderKind;
            onChange({ provider, model: models.find((m) => m.provider === provider)?.id ?? "default" });
          }}
        >
          <SelectTrigger className="h-10 w-full" aria-label={`${label} provider`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {optional && <SelectItem value="none">None</SelectItem>}
            {providers.map((p) => (
              <SelectItem key={p.kind} value={p.kind} disabled={!p.configured}>
                {PROVIDER_LABELS[p.kind]}
                {!p.configured ? " (not configured)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {value && value.provider === "OPENAI_COMPATIBLE" ? (
          <input
            className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm"
            value={value.model}
            onChange={(e) => onChange({ ...value, model: e.target.value })}
            aria-label={`${label} model name`}
            placeholder="model name"
          />
        ) : (
          <Select key={value?.provider ?? "none"} value={value?.model ?? ""} onValueChange={(m) => value && onChange({ ...value, model: m })} disabled={!value}>
            <SelectTrigger className="h-10 w-full" aria-label={`${label} model`}>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {models
                .filter((m) => m.provider === value?.provider)
                .map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

function DelegationSection({ agent, others, canEdit }: { agent: SettingsAgent; others: { id: string; name: string; jobTitle: string }[]; canEdit: boolean }) {
  const [ids, setIds] = useState(agent.delegateIds);
  const save = useAction(updateDelegatesAction, { success: "Delegation saved." });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save.run({ agentId: agent.id, delegateIds: ids });
      }}
    >
      <fieldset disabled={!canEdit} className="contents">
        <Card
          title="Delegation"
          description={`Employees ${agent.name} may hand work to. Delegated work runs with the delegate's own permissions — never ${agent.name}'s.`}
          footer={canEdit && <SaveButton pending={save.pending} />}
        >
          {others.length === 0 ? (
            <p className="text-[13px] text-text-muted">Hire more employees to enable delegation.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {others.map((o) => (
                <li key={o.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
                    <Checkbox checked={ids.includes(o.id)} onCheckedChange={(v) => setIds((p) => (v ? [...p, o.id] : p.filter((x) => x !== o.id)))} />
                    <span className="text-[13.5px]">
                      <span className="font-medium">{o.name}</span> <span className="text-text-muted">· {o.jobTitle}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </fieldset>
    </form>
  );
}
