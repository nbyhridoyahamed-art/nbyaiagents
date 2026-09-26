"use client";

import { useState } from "react";
import { CheckCircle2, KeyRound, Loader2, TriangleAlert, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/forms/field";
import { ConfirmButton } from "@/components/common/confirm-button";
import { useAction } from "@/hooks/use-action";
import { PROVIDER_LABELS } from "@/lib/ai/models";
import type { ProviderKind } from "@/lib/generated/prisma/enums";
import { removeProviderKeyAction, saveProviderKeyAction, testProviderAction } from "./actions";

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
  GOOGLE: "Gemini models. Also enables Google embeddings for knowledge search.",
  OPENAI_COMPATIBLE: "Any server that speaks the OpenAI Chat Completions API (e.g. a self-hosted model).",
};

export function ProvidersView({ providers, canManage, offlineAgents }: { providers: ProviderRow[]; canManage: boolean; offlineAgents: number }) {
  return (
    <div className="grid gap-5">
      <div className="rounded-xl border bg-surface p-5 shadow-card">
        <h2 className="text-card-title">AI providers</h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          Keys are encrypted at rest (AES-256-GCM), never shown again after saving, never logged and never sent to the AI model.
        </p>
        {offlineAgents > 0 && (
          <p className="mt-3 flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning-text">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {offlineAgents} employee{offlineAgents === 1 ? " uses" : "s use"} the offline demo model (rule-based, not AI). After adding a key, switch their model in each
            employee&apos;s Settings.
          </p>
        )}
      </div>
      {providers.map((p) => (
        <ProviderCard key={p.kind} p={p} canManage={canManage} />
      ))}
    </div>
  );
}

function ProviderCard({ p, canManage }: { p: ProviderRow; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(p.baseUrl ?? "");
  const [defaultModel, setDefaultModel] = useState(p.defaultModel ?? "");
  const save = useAction(saveProviderKeyAction, {
    success: `${PROVIDER_LABELS[p.kind]} key saved.`,
    onSuccess: () => {
      setEditing(false);
      setApiKey("");
    },
  });
  const remove = useAction(removeProviderKeyAction, { success: "Key removed." });
  const test = useAction(testProviderAction, { refresh: false });

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
          </h3>
          <p className="text-[13px] text-text-secondary">{DOCS[p.kind]}</p>
          {p.hint && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
              <KeyRound className="size-3.5" aria-hidden /> Key {p.hint}
              {p.baseUrl ? ` · ${p.baseUrl}` : ""} · used by {p.agents} employee{p.agents === 1 ? "" : "s"}
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
              {p.hint ? "Replace key" : "Add key"}
            </Button>
            {p.hint && (
              <ConfirmButton size="sm" variant="ghost" destructive title={`Remove the ${PROVIDER_LABELS[p.kind]} key?`} description="Employees using this provider will stop working until another key is added." confirmLabel="Remove" onConfirm={() => remove.run(p.kind)}>
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
            void save.run({ kind: p.kind, apiKey, baseUrl: baseUrl || undefined, defaultModel: defaultModel || undefined });
          }}
        >
          <Field label="API key" name="apiKey" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} error={save.fieldErrors.apiKey} className="sm:col-span-2" />
          {p.kind === "OPENAI_COMPATIBLE" && (
            <>
              <Field label="Base URL" name="baseUrl" placeholder="https://my-llm.example.com/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} error={save.fieldErrors.baseUrl} />
              <Field label="Model name" name="defaultModel" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} error={save.fieldErrors.defaultModel} />
            </>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.pending || apiKey.length < 8}>
              {save.pending && <Loader2 className="animate-spin" aria-hidden />} Save encrypted
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
