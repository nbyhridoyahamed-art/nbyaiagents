"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink, Gift, KeyRound, Loader2, TriangleAlert, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/forms/field";
import { ConfirmButton } from "@/components/common/confirm-button";
import { ModelCombobox } from "@/components/ai/model-combobox";
import { useAction } from "@/hooks/use-action";
import { PROVIDER_LABELS } from "@/lib/ai/models";
import { OPENAI_STYLE_PRESETS, isOpenModelProvider } from "@/lib/ai/provider-presets";
import type { ProviderKind } from "@/lib/generated/prisma/enums";
import { removeProviderKeyAction, saveProviderKeyAction, setProviderModelAction, testProviderAction } from "./actions";

interface ProviderRow {
  kind: ProviderKind;
  configured: boolean;
  source: string;
  hint: string | null;
  baseUrl: string | null;
  defaultModel: string | null;
  agents: number;
}

const DOCS: Partial<Record<ProviderKind, string>> = {
  ANTHROPIC: "Claude models (Opus, Sonnet, Haiku). Keys start with sk-ant-.",
  OPENAI: "GPT models. Also enables OpenAI embeddings for knowledge search.",
  GOOGLE: "Gemini models. Also enables Google embeddings for knowledge search. Google AI Studio has a free tier.",
  OPENAI_COMPATIBLE: "Any other server that speaks the OpenAI Chat Completions API (vLLM, LM Studio, Together, DeepSeek…).",
};

export function ProvidersView({ providers, canManage, offlineAgents }: { providers: ProviderRow[]; canManage: boolean; offlineAgents: number }) {
  const hosted = providers.filter((p) => !OPENAI_STYLE_PRESETS[p.kind] && p.kind !== "OPENAI_COMPATIBLE");
  const open = providers.filter((p) => OPENAI_STYLE_PRESETS[p.kind] || p.kind === "OPENAI_COMPATIBLE");
  return (
    <div className="grid gap-5">
      <div className="rounded-xl border bg-surface p-5 shadow-card">
        <h2 className="text-card-title">AI providers</h2>
        <p className="mt-1 text-[13px] text-text-secondary">Keys are encrypted at rest (AES-256-GCM), never shown again after saving, never logged and never sent to the AI model.</p>
        {offlineAgents > 0 && (
          <p className="mt-3 flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning-text">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {offlineAgents} employee{offlineAgents === 1 ? " uses" : "s use"} the offline demo model (rule-based, not AI). After adding a key, switch their model in each employee&apos;s Settings.
          </p>
        )}
      </div>
      <h3 className="mt-2 text-[13px] font-semibold uppercase tracking-wide text-text-muted">Model labs</h3>
      {hosted.map((p) => (
        <ProviderCard key={p.kind} p={p} canManage={canManage} />
      ))}
      <div className="mt-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-text-muted">Free tiers &amp; open models</h3>
        <p className="mt-1 text-[13px] text-text-secondary">Free tiers are rate-limited and smaller open models are less reliable at multi-step tool use. Test an employee before relying on it.</p>
      </div>
      {open.map((p) => (
        <ProviderCard key={p.kind} p={p} canManage={canManage} />
      ))}
    </div>
  );
}

function ProviderCard({ p, canManage }: { p: ProviderRow; canManage: boolean }) {
  const preset = OPENAI_STYLE_PRESETS[p.kind];
  const keyRequired = preset ? preset.keyRequired : true;
  const needsBaseUrl = p.kind === "OPENAI_COMPATIBLE" || p.kind === "OLLAMA";
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(p.baseUrl ?? "");
  const [defaultModel, setDefaultModel] = useState(p.defaultModel ?? "");
  const [model, setModel] = useState(p.defaultModel ?? "");
  const save = useAction(saveProviderKeyAction, {
    onSuccess: (data) => {
      setEditing(false);
      setApiKey("");
      if (data.defaultModel) setModel(data.defaultModel);
      toast.success(
        isOpenModelProvider(p.kind) && !data.defaultModel
          ? `${PROVIDER_LABELS[p.kind]} connected. Choose a default model below.`
          : `${PROVIDER_LABELS[p.kind]} connected${data.defaultModel && isOpenModelProvider(p.kind) ? ` — default model ${data.defaultModel}` : ""}.`,
      );
    },
  });
  const saveModel = useAction(setProviderModelAction, { success: "Default model saved." });
  const remove = useAction(removeProviderKeyAction, { success: "Provider removed." });
  const test = useAction(testProviderAction, { refresh: false });
  const connectedHere = p.source === "organization";

  return (
    <section className="rounded-xl border bg-surface p-5 shadow-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="flex flex-wrap items-center gap-2 text-card-title">
            {PROVIDER_LABELS[p.kind]}
            {p.configured ? (
              <Badge className="bg-success-soft text-success-text">
                <CheckCircle2 aria-hidden /> {p.source === "platform" ? "Configured by platform" : "Connected"}
              </Badge>
            ) : (
              <Badge variant="secondary">Not configured</Badge>
            )}
            {preset && (
              <Badge variant="outline" className="text-success-text">
                <Gift aria-hidden /> Free option
              </Badge>
            )}
          </h3>
          <p className="text-[13px] text-text-secondary">{preset?.description ?? DOCS[p.kind]}</p>
          {preset && <p className="mt-1 text-xs text-text-muted">{preset.freeNote}</p>}
          {preset?.signupUrl && !p.configured && (
            <a href={preset.signupUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand underline">
              Get a {preset.keyRequired ? "free API key" : "server"} <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
          {(p.hint || p.baseUrl) && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
              <KeyRound className="size-3.5" aria-hidden />
              {[p.hint ? `Key ${p.hint}` : null, p.baseUrl, `used by ${p.agents} employee${p.agents === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            {p.configured && (
              <Button
                variant="outline"
                size="sm"
                disabled={test.pending}
                onClick={() =>
                  void test.run(p.kind).then((r) => {
                    if (r.ok) toast.success(`Working — ${r.data.model} replied in ${r.data.latencyMs} ms.`);
                  })
                }
              >
                {test.pending ? <Loader2 className="animate-spin" aria-hidden /> : <Zap aria-hidden />} Test
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setEditing((e) => !e)}>
              {connectedHere ? (keyRequired ? "Replace key" : "Edit") : keyRequired ? "Add key" : "Connect"}
            </Button>
            {connectedHere && (
              <ConfirmButton
                size="sm"
                variant="ghost"
                destructive
                title={`Remove ${PROVIDER_LABELS[p.kind]}?`}
                description="Employees using this provider will stop working until it's connected again."
                confirmLabel="Remove"
                onConfirm={() => remove.run(p.kind)}
              >
                Remove
              </ConfirmButton>
            )}
          </div>
        )}
      </div>

      {editing && (
        <form
          className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run({ kind: p.kind, apiKey, baseUrl: baseUrl || undefined, defaultModel: p.kind === "OPENAI_COMPATIBLE" ? defaultModel || undefined : undefined });
          }}
        >
          <Field
            label={keyRequired ? "API key" : "API key (optional)"}
            name="apiKey"
            type="password"
            autoComplete="off"
            placeholder={preset?.keyPlaceholder}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            error={save.fieldErrors.apiKey}
            className="sm:col-span-2"
          />
          {needsBaseUrl && (
            <Field
              label="Base URL"
              name="baseUrl"
              placeholder={preset?.baseUrlPlaceholder ?? "https://my-llm.example.com/v1"}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              error={save.fieldErrors.baseUrl}
              hint={p.kind === "OLLAMA" ? "Must be reachable from this server over the internet — http://localhost only works when the app runs on the same machine." : undefined}
              className={p.kind === "OLLAMA" ? "sm:col-span-2" : undefined}
            />
          )}
          {p.kind === "OPENAI_COMPATIBLE" && (
            <Field label="Model name" name="defaultModel" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} error={save.fieldErrors.defaultModel} />
          )}
          {preset && <p className="text-xs text-text-muted sm:col-span-2">After connecting, a free model that supports tools is chosen as the default. You can change it below.</p>}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.pending || (keyRequired && apiKey.length < 8)}>
              {save.pending && <Loader2 className="animate-spin" aria-hidden />} {keyRequired || apiKey ? "Save encrypted" : "Connect"}
            </Button>
          </div>
        </form>
      )}

      {preset && connectedHere && canManage && !editing && (
        <form
          className="mt-4 grid gap-2 border-t pt-4 sm:grid-cols-[1fr_auto] sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            void saveModel.run({ kind: p.kind, model });
          }}
        >
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Default model</span>
            <ModelCombobox provider={p.kind} value={model} onChange={setModel} ariaLabel={`${PROVIDER_LABELS[p.kind]} default model`} />
          </div>
          <Button type="submit" variant="outline" className="sm:mt-6" disabled={saveModel.pending || !model.trim() || model === p.defaultModel}>
            {saveModel.pending && <Loader2 className="animate-spin" aria-hidden />} Save model
          </Button>
        </form>
      )}
      {preset && p.configured && !connectedHere && p.defaultModel && <p className="mt-2 text-xs text-text-muted">Default model: {p.defaultModel}</p>}
    </section>
  );
}
