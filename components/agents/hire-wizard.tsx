"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  LayoutTemplate,
  Loader2,
  Plug,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FormError } from "@/components/forms/field";
import { ListEditor } from "@/components/forms/list-editor";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { PermissionSelect, EFFECT_META, type Effect } from "@/components/agents/permission-select";
import { RiskBadge, SimulatedBadge } from "@/components/tools/risk-badge";
import { AVATAR_COLORS, INSTRUCTION_SECTIONS, PERSONALITIES, type CreateAgentInput, type InstructionKey } from "@/lib/agents/schema";
import { PROVIDER_LABELS } from "@/lib/ai/models";
import { isOpenModelProvider } from "@/lib/ai/provider-presets";
import { ModelCombobox } from "@/components/ai/model-combobox";
import type { ProviderKind, RiskLevel } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { createAgentAction } from "@/app/(app)/agents/actions";
import { AiDraftPanel } from "@/components/agents/ai-draft-panel";

export interface WizardOptions {
  departments: { id: string; name: string }[];
  knowledgeBases: { id: string; name: string; description: string | null; documents: number }[];
  tools: { id: string; key: string; name: string; description: string; riskLevel: RiskLevel; capabilities: string[]; isSimulated: boolean; kind: string }[];
  workflows: { id: string; name: string; status: string }[];
  providers: { kind: ProviderKind; configured: boolean; source: string; defaultModel?: string | null }[];
  models: { id: string; provider: ProviderKind; label: string; description: string; recommended: boolean }[];
  defaultModel: { provider: ProviderKind; model: string };
  templates: { key: string; name: string; jobTitle: string; department: string; summary: string; color: string }[];
  companyPolicies: { name: string; rule: string; enforced: boolean }[];
}

const STEPS = [
  { key: "identity", label: "Identity" },
  { key: "role", label: "Role" },
  { key: "personality", label: "Personality" },
  { key: "instructions", label: "Instructions" },
  { key: "knowledge", label: "Knowledge" },
  { key: "tools", label: "Tools" },
  { key: "permissions", label: "Permissions" },
  { key: "workflows", label: "Workflows" },
  { key: "review", label: "Review" },
] as const;

const PRIMARY_SECTIONS: InstructionKey[] = ["ROLE", "RULES", "MUST_DO", "MUST_NEVER", "TONE", "ESCALATION_RULES"];

type Draft = {
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
  knowledgeBaseIds: string[];
  tools: { toolId: string; effect: Effect }[];
  workflowIds: string[];
  model: { provider: ProviderKind; model: string };
  templateKey?: string;
};

function toDraft(input: CreateAgentInput | null, fallbackModel: Draft["model"]): Draft {
  return {
    name: input?.name ?? "",
    jobTitle: input?.jobTitle ?? "",
    departmentId: input?.departmentId ?? null,
    description: input?.description ?? "",
    avatarColor: input?.avatarColor ?? AVATAR_COLORS[0],
    mission: input?.mission ?? "",
    responsibilities: input?.responsibilities ?? [],
    goals: input?.goals ?? [],
    kpis: input?.kpis ?? [],
    priority: input?.priority ?? "MEDIUM",
    personality: input?.personality ?? "professional",
    personalityNotes: input?.personalityNotes ?? "",
    instructions: input?.instructions ?? {},
    knowledgeBaseIds: input?.knowledgeBaseIds ?? [],
    tools: (input?.tools ?? []).map((t) => ({ toolId: t.toolId, effect: t.effect })),
    workflowIds: input?.workflowIds ?? [],
    model: input?.model ? { provider: input.model.provider, model: input.model.model } : fallbackModel,
    templateKey: input?.templateKey,
  };
}

/** Recommended permission for a tool when an admin first assigns it. */
function defaultEffect(risk: RiskLevel, capabilities: string[]): Effect {
  if (risk === "CRITICAL" || capabilities.includes("financial") || capabilities.includes("data_deletion")) return "DENY";
  if (risk === "HIGH" || risk === "MEDIUM" || capabilities.includes("external_communication")) return "REQUIRE_APPROVAL";
  return "ALLOW";
}

export function HireWizard({ options, initial, mode, aiPrompt }: { options: WizardOptions; initial: CreateAgentInput | null; mode: "choose" | "template" | "ai"; aiPrompt?: string }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [stage, setStage] = useState<"choose" | "ai" | "wizard">(mode === "template" ? "wizard" : mode);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial, options.defaultModel));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const selectedTools = useMemo(() => options.tools.filter((t) => draft.tools.some((x) => x.toolId === t.id)), [options.tools, draft.tools]);

  function validateStep(i: number): boolean {
    const e: Record<string, string> = {};
    if (STEPS[i].key === "identity") {
      if (!draft.name.trim()) e.name = "Give your employee a name.";
      if (!draft.jobTitle.trim()) e.jobTitle = "Add a job title.";
    }
    if (STEPS[i].key === "role" && !draft.mission.trim() && draft.responsibilities.length === 0) {
      e.mission = "Add a mission or at least one responsibility.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function goTo(i: number) {
    if (i > step) {
      for (let s = step; s < i; s++) if (!validateStep(s)) return setStep(s);
    }
    setStep(i);
  }

  function hire() {
    setFormError(null);
    start(async () => {
      const res = await createAgentAction({
        ...draft,
        model: { provider: draft.model.provider, model: draft.model.model, temperature: 0.3, maxOutputTokens: 4000 },
        personality: draft.personality as CreateAgentInput["personality"],
      });
      if (!res.ok) {
        setFormError(res.error);
        setErrors(res.fieldErrors ?? {});
        if (res.fieldErrors?.name || res.fieldErrors?.jobTitle) setStep(0);
        return;
      }
      toast.success(`${draft.name} was hired as a draft. Review and publish to start work.`);
      router.push(`/agents/${res.data.id}`);
    });
  }

  if (stage === "choose") {
    return <StartChooser templates={options.templates} onScratch={() => setStage("wizard")} onAi={() => setStage("ai")} />;
  }
  if (stage === "ai") {
    return (
      <AiDraftPanel
        initialText={aiPrompt}
        onBack={() => setStage("choose")}
        onDraft={(input) => {
          setDraft(toDraft({ ...input, knowledgeBaseIds: [], tools: input.tools ?? [], workflowIds: [] }, options.defaultModel));
          setStage("wizard");
          setStep(0);
        }}
      />
    );
  }

  const current = STEPS[step];
  const configuredProviders = options.providers.filter((p) => p.configured);

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      {/* Step navigation */}
      <nav aria-label="Hiring steps" className="lg:sticky lg:top-24 lg:self-start">
        <ol className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => goTo(i)}
                aria-current={i === step ? "step" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
                  i === step ? "bg-brand-soft text-brand-hover" : "text-text-secondary hover:bg-surface-2",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                    i < step ? "bg-brand text-white" : i === step ? "bg-brand text-white" : "bg-surface-2 text-text-muted",
                  )}
                >
                  {i < step ? <Check className="size-3" aria-hidden /> : i + 1}
                </span>
                {s.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="min-w-0">
        <div className="rounded-2xl border bg-surface p-5 shadow-card sm:p-7">
          <FormError message={formError} />
          <AnimatePresence mode="wait">
            <motion.div
              key={current.key}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              {current.key === "identity" && (
                <StepShell title="Identity" description="Who is this employee?">
                  <div className="flex items-center gap-4">
                    <AgentAvatar name={draft.name || "?"} color={draft.avatarColor} size={56} />
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Avatar colour">
                      {AVATAR_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={draft.avatarColor === c}
                          aria-label={`Colour ${c}`}
                          onClick={() => set("avatarColor", c)}
                          className={cn("size-6 rounded-full ring-offset-2 ring-offset-surface", draft.avatarColor === c && "ring-2 ring-foreground")}
                          style={{ background: c }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Name" name="name" value={draft.name} onChange={(e) => set("name", e.target.value)} error={errors.name} placeholder="Sarah" maxLength={60} autoFocus />
                    <Field label="Job title" name="jobTitle" value={draft.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} error={errors.jobTitle} placeholder="Sales Manager" maxLength={80} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-[13px]">Department</Label>
                    <Select value={draft.departmentId ?? "none"} onValueChange={(v) => set("departmentId", v === "none" ? null : v)}>
                      <SelectTrigger className="h-10 w-full sm:w-72">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No department</SelectItem>
                        {options.departments.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Field label="Description" name="description" multiline rows={3} defaultValue={draft.description} onChange={(e) => set("description", e.target.value)} maxLength={500} placeholder="What does this employee do for the company?" />
                </StepShell>
              )}

              {current.key === "role" && (
                <StepShell title="Role" description="Define the mission and what success looks like.">
                  <Field label="Mission" name="mission" multiline rows={2} defaultValue={draft.mission} onChange={(e) => set("mission", e.target.value)} error={errors.mission} maxLength={500} placeholder="Turn new leads into qualified sales conversations." />
                  <ListEditor label="Responsibilities" items={draft.responsibilities} onChange={(v) => set("responsibilities", v)} placeholder="Qualify inbound leads" />
                  <ListEditor label="Goals" items={draft.goals} onChange={(v) => set("goals", v)} placeholder="Respond to every lead within one business day" />
                  <ListEditor label="KPIs" items={draft.kpis} onChange={(v) => set("kpis", v)} placeholder="Leads qualified per week" />
                  <div className="grid gap-1.5">
                    <Label className="text-[13px]">Priority</Label>
                    <Select value={draft.priority} onValueChange={(v) => set("priority", v as Draft["priority"])}>
                      <SelectTrigger className="h-10 w-full sm:w-48">
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
                </StepShell>
              )}

              {current.key === "personality" && (
                <StepShell title="Personality" description="How should this employee communicate?">
                  <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Personality">
                    {PERSONALITIES.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        role="radio"
                        aria-checked={draft.personality === p.key}
                        onClick={() => set("personality", p.key)}
                        className={cn(
                          "rounded-xl border p-3 text-left transition-colors",
                          draft.personality === p.key ? "border-brand bg-brand-soft" : "hover:bg-surface-2",
                        )}
                      >
                        <span className="block text-[13.5px] font-semibold">{p.label}</span>
                        <span className="block text-xs text-text-secondary">{p.description}</span>
                      </button>
                    ))}
                  </div>
                  <Field label="Custom style notes (optional)" name="personalityNotes" multiline rows={3} defaultValue={draft.personalityNotes} onChange={(e) => set("personalityNotes", e.target.value)} maxLength={1000} placeholder="Use British spelling. Sign off as “Sarah from Acme”." />
                </StepShell>
              )}

              {current.key === "instructions" && (
                <StepShell title="Instructions" description="Structured instructions become the employee's operating manual. Company policies always take priority.">
                  <div className="grid gap-4">
                    {INSTRUCTION_SECTIONS.filter((s) => PRIMARY_SECTIONS.includes(s.key)).map((s) => (
                      <InstructionField key={s.key} section={s} value={draft.instructions[s.key] ?? ""} onChange={(v) => set("instructions", { ...draft.instructions, [s.key]: v })} />
                    ))}
                  </div>
                  <Collapsible>
                    <CollapsibleTrigger className="group flex items-center gap-1.5 text-[13px] font-medium text-brand">
                      <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden /> More sections
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-4 grid gap-4">
                      {INSTRUCTION_SECTIONS.filter((s) => !PRIMARY_SECTIONS.includes(s.key)).map((s) => (
                        <InstructionField key={s.key} section={s} value={draft.instructions[s.key] ?? ""} onChange={(v) => set("instructions", { ...draft.instructions, [s.key]: v })} />
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                </StepShell>
              )}

              {current.key === "knowledge" && (
                <StepShell title="Knowledge" description="Knowledge isn't shared with every employee automatically. Choose what this employee may read.">
                  {options.knowledgeBases.length === 0 ? (
                    <InlineEmpty icon={BookOpen} text="No knowledge collections yet. You can add knowledge after hiring." href="/knowledge" cta="Open Knowledge" />
                  ) : (
                    <ul className="grid gap-2">
                      {options.knowledgeBases.map((kb) => {
                        const checked = draft.knowledgeBaseIds.includes(kb.id);
                        return (
                          <li key={kb.id}>
                            <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3", checked && "border-brand bg-brand-soft/50")}>
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => set("knowledgeBaseIds", v ? [...draft.knowledgeBaseIds, kb.id] : draft.knowledgeBaseIds.filter((x) => x !== kb.id))}
                                className="mt-0.5"
                              />
                              <span className="min-w-0">
                                <span className="block text-[13.5px] font-medium">{kb.name}</span>
                                <span className="block text-xs text-text-muted">
                                  {kb.documents} document{kb.documents === 1 ? "" : "s"}
                                  {kb.description ? ` · ${kb.description}` : ""}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </StepShell>
              )}

              {current.key === "tools" && (
                <StepShell title="Tools" description="Which tools and integrations can this employee use? You'll set exact permissions next.">
                  {options.tools.length === 0 ? (
                    <InlineEmpty icon={Plug} text="No tools available yet. Connect an integration or create a custom API tool." href="/integrations" cta="Open Integrations" />
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {options.tools.map((t) => {
                        const checked = draft.tools.some((x) => x.toolId === t.id);
                        return (
                          <li key={t.id}>
                            <label className={cn("flex h-full cursor-pointer items-start gap-3 rounded-xl border p-3", checked && "border-brand bg-brand-soft/50")}>
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) =>
                                  set(
                                    "tools",
                                    v ? [...draft.tools, { toolId: t.id, effect: defaultEffect(t.riskLevel, t.capabilities) }] : draft.tools.filter((x) => x.toolId !== t.id),
                                  )
                                }
                                className="mt-0.5"
                              />
                              <span className="min-w-0">
                                <span className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium">
                                  {t.name}
                                  {t.isSimulated && <SimulatedBadge />}
                                </span>
                                <span className="mt-0.5 block text-xs text-text-muted">{t.description}</span>
                                <RiskBadge risk={t.riskLevel} className="mt-1.5" />
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </StepShell>
              )}

              {current.key === "permissions" && (
                <StepShell title="Permissions" description="Enforced by the platform at runtime, not by the prompt. Company policies and approval rules still apply on top.">
                  {selectedTools.length === 0 ? (
                    <InlineEmpty icon={ShieldCheck} text="No tools selected. This employee can chat and use approved knowledge only." />
                  ) : (
                    <ul className="divide-y rounded-xl border">
                      {selectedTools.map((t) => {
                        const assignment = draft.tools.find((x) => x.toolId === t.id)!;
                        return (
                          <li key={t.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                            <div className="min-w-0 flex-1">
                              <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium">
                                {t.name} <RiskBadge risk={t.riskLevel} />
                              </p>
                              <p className="text-xs text-text-muted">{t.key}</p>
                            </div>
                            <PermissionSelect
                              label={t.name}
                              value={assignment.effect}
                              onChange={(effect) => set("tools", draft.tools.map((x) => (x.toolId === t.id ? { ...x, effect } : x)))}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {options.companyPolicies.length > 0 && (
                    <div className="rounded-xl border bg-background p-4">
                      <p className="text-[13px] font-semibold">Company policies that always apply</p>
                      <ul className="mt-2 grid gap-1.5 text-[13px] text-text-secondary">
                        {options.companyPolicies.map((p) => (
                          <li key={p.name} className="flex gap-2">
                            <ShieldCheck className={cn("mt-0.5 size-4 shrink-0", p.enforced ? "text-brand" : "text-text-muted")} aria-hidden />
                            <span>
                              {p.rule} {p.enforced && <span className="text-xs font-medium text-brand">(runtime-enforced)</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </StepShell>
              )}

              {current.key === "workflows" && (
                <StepShell title="Workflows" description="Assign existing automations this employee is responsible for.">
                  {options.workflows.length === 0 ? (
                    <InlineEmpty icon={WorkflowIcon} text="No workflows yet. You can build one after hiring." href="/workflows" cta="Open Workflows" />
                  ) : (
                    <ul className="grid gap-2">
                      {options.workflows.map((w) => {
                        const checked = draft.workflowIds.includes(w.id);
                        return (
                          <li key={w.id}>
                            <label className={cn("flex cursor-pointer items-center gap-3 rounded-xl border p-3", checked && "border-brand bg-brand-soft/50")}>
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => set("workflowIds", v ? [...draft.workflowIds, w.id] : draft.workflowIds.filter((x) => x !== w.id))}
                              />
                              <span className="flex-1 text-[13.5px] font-medium">{w.name}</span>
                              <span className="text-xs capitalize text-text-muted">{w.status.toLowerCase()}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </StepShell>
              )}

              {current.key === "review" && (
                <StepShell title="Review" description="Your new employee starts as a draft. Test them, then publish to let them do live work.">
                  <div className="flex items-center gap-4 rounded-xl border bg-background p-4">
                    <AgentAvatar name={draft.name || "?"} color={draft.avatarColor} size={52} />
                    <div>
                      <p className="text-card-title">{draft.name || "Unnamed"}</p>
                      <p className="text-[13px] text-text-secondary">
                        {draft.jobTitle || "No title"}
                        {draft.departmentId ? ` · ${options.departments.find((d) => d.id === draft.departmentId)?.name}` : ""}
                      </p>
                    </div>
                  </div>
                  <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
                    <ReviewItem label="Mission" value={draft.mission || "—"} onEdit={() => setStep(1)} />
                    <ReviewItem label="Responsibilities" value={draft.responsibilities.length ? draft.responsibilities.join(", ") : "—"} onEdit={() => setStep(1)} />
                    <ReviewItem label="Personality" value={PERSONALITIES.find((p) => p.key === draft.personality)?.label ?? draft.personality} onEdit={() => setStep(2)} />
                    <ReviewItem label="Instructions" value={`${Object.values(draft.instructions).filter((v) => v?.trim()).length} section(s) written`} onEdit={() => setStep(3)} />
                    <ReviewItem label="Knowledge" value={draft.knowledgeBaseIds.length ? options.knowledgeBases.filter((k) => draft.knowledgeBaseIds.includes(k.id)).map((k) => k.name).join(", ") : "None"} onEdit={() => setStep(4)} />
                    <ReviewItem
                      label="Tools & permissions"
                      value={
                        selectedTools.length
                          ? selectedTools.map((t) => `${t.name}: ${EFFECT_META[draft.tools.find((x) => x.toolId === t.id)!.effect].label}`).join("; ")
                          : "None"
                      }
                      onEdit={() => setStep(6)}
                    />
                    <ReviewItem label="Workflows" value={draft.workflowIds.length ? options.workflows.filter((w) => draft.workflowIds.includes(w.id)).map((w) => w.name).join(", ") : "None"} onEdit={() => setStep(7)} />
                  </dl>
                  <div className="grid gap-2 rounded-xl border p-4">
                    <p className="text-[13px] font-semibold">AI model</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Select
                        value={draft.model.provider}
                        onValueChange={(v) => {
                          const provider = v as ProviderKind;
                          const first = options.models.find((m) => m.provider === provider);
                          const fallback = isOpenModelProvider(provider) ? (options.providers.find((p) => p.kind === provider)?.defaultModel ?? "") : "";
                          set("model", { provider, model: first?.id ?? fallback });
                        }}
                      >
                        <SelectTrigger className="h-10 w-full" aria-label="Provider">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {options.providers.map((p) => (
                            <SelectItem key={p.kind} value={p.kind} disabled={!p.configured}>
                              {PROVIDER_LABELS[p.kind]}
                              {!p.configured && " — not configured"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isOpenModelProvider(draft.model.provider) ? (
                        <ModelCombobox provider={draft.model.provider} value={draft.model.model} onChange={(v) => set("model", { ...draft.model, model: v })} ariaLabel="Model" />
                      ) : (
                        <Select value={draft.model.model} onValueChange={(v) => set("model", { ...draft.model, model: v })}>
                          <SelectTrigger className="h-10 w-full" aria-label="Model">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {options.models
                              .filter((m) => m.provider === draft.model.provider)
                              .map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.label}
                                  {m.recommended ? " (recommended)" : ""}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <p className="text-xs text-text-muted">{options.models.find((m) => m.id === draft.model.model)?.description}</p>
                    {configuredProviders.length === 1 && (
                      <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-text">
                        No AI provider is connected, so this employee will use the offline demo model — a rule-based stand-in that is not real AI.{" "}
                        <Link href="/settings/providers" className="font-medium underline">
                          Connect a provider
                        </Link>
                      </p>
                    )}
                  </div>
                </StepShell>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => (step === 0 ? setStage("choose") : setStep(step - 1))} disabled={pending}>
            <ArrowLeft aria-hidden /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button size="lg" onClick={() => goTo(step + 1)}>
              Continue <ArrowRight aria-hidden />
            </Button>
          ) : (
            <Button size="lg" onClick={hire} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
              Hire AI Employee
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-5">
      <header>
        <h2 className="text-section-title">{title}</h2>
        <p className="mt-0.5 text-[13px] text-text-secondary">{description}</p>
      </header>
      {children}
    </section>
  );
}

function InstructionField({ section, value, onChange }: { section: (typeof INSTRUCTION_SECTIONS)[number]; value: string; onChange: (v: string) => void }) {
  const id = `instr-${section.key}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-[13px]">
        {section.label}
      </Label>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={section.placeholder} rows={2} maxLength={4000} />
    </div>
  );
}

function InlineEmpty({ icon: Icon, text, href, cta }: { icon: typeof BookOpen; text: string; href?: string; cta?: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-5 sm:flex-row sm:items-center">
      <Icon className="size-5 text-text-muted" aria-hidden />
      <p className="flex-1 text-[13px] text-text-secondary">{text}</p>
      {href && cta && (
        <Button asChild variant="outline" size="sm">
          <Link href={href} target="_blank">
            {cta}
          </Link>
        </Button>
      )}
    </div>
  );
}

function ReviewItem({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <dt className="text-xs font-medium text-text-muted">{label}</dt>
        <button type="button" onClick={onEdit} className="text-xs font-medium text-brand hover:underline">
          Edit
        </button>
      </div>
      <dd className="mt-1 line-clamp-3">{value}</dd>
    </div>
  );
}

function StartChooser({
  templates,
  onScratch,
  onAi,
}: {
  templates: WizardOptions["templates"];
  onScratch: () => void;
  onAi: () => void;
}) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={onScratch} className="flex items-start gap-3 rounded-2xl border bg-surface p-5 text-left shadow-card transition-all hover:-translate-y-px hover:shadow-card-hover">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <FileText className="size-5" aria-hidden />
          </span>
          <span>
            <span className="block text-card-title">Start from scratch</span>
            <span className="block text-[13px] text-text-secondary">Define a custom role step by step — any job, not just templates.</span>
          </span>
        </button>
        <button type="button" onClick={onAi} className="flex items-start gap-3 rounded-2xl border bg-surface p-5 text-left shadow-card transition-all hover:-translate-y-px hover:shadow-card-hover">
          <span className="flex size-10 items-center justify-center rounded-xl bg-ai-soft text-ai">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <span>
            <span className="block text-card-title">Create with AI</span>
            <span className="block text-[13px] text-text-secondary">Describe the job in plain words. You review everything before hiring.</span>
          </span>
        </button>
      </div>
      <div>
        <h2 className="mb-3 flex items-center gap-2 text-card-title">
          <LayoutTemplate className="size-4 text-text-muted" aria-hidden /> Or start from a template
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <li key={t.key}>
              <Link
                href={`/agents/new?template=${t.key}`}
                className="flex h-full gap-3 rounded-xl border bg-surface p-4 shadow-card transition-all hover:-translate-y-px hover:shadow-card-hover"
              >
                <AgentAvatar name={t.name} color={t.color} size={40} />
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold">{t.jobTitle}</span>
                  <span className="block text-xs text-text-muted">{t.department}</span>
                  <span className="mt-1 block text-[13px] text-text-secondary">{t.summary}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
