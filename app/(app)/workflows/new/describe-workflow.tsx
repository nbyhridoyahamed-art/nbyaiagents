"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Info, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { RunGraphLoader } from "@/app/(app)/workflows/runs/[runId]/run-graph-loader";
import type { GeneratedWorkflow } from "@/server/services/workflow-generator";
import { createGeneratedWorkflowAction, generateWorkflowAction } from "../actions";

const EXAMPLE = "Whenever I receive a new website lead, research the company, score the lead, add it to the CRM, draft an email, and ask me for approval before sending.";

/** Describe → preview → create as draft (spec §40). Nothing is activated here. */
export function DescribeWorkflow({ initial }: { initial?: string }) {
  const router = useRouter();
  const [description, setDescription] = useState(initial ?? "");
  const [draft, setDraft] = useState<GeneratedWorkflow | null>(null);
  const [name, setName] = useState("");
  const generate = useAction(generateWorkflowAction, {
    refresh: false,
    onSuccess: (d) => {
      setDraft(d);
      setName(d.name);
    },
  });
  const create = useAction(createGeneratedWorkflowAction, { refresh: false, success: "Draft created. Review it, run a test, then publish.", onSuccess: (d) => router.push(`/workflows/${d.id}`) });

  // Arriving from "Ask Virtual Desks AI" with a description: generate straight away.
  const started = useRef(false);
  useEffect(() => {
    if (initial && !started.current) {
      started.current = true;
      void generate.run({ description: initial });
    }
  }, [initial, generate]);

  const errors = draft?.issues.filter((i) => i.level === "error") ?? [];
  return (
    <div className="grid gap-4">
      <form
        className="grid gap-3 rounded-2xl border bg-surface p-6 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          void generate.run({ description });
        }}
      >
        <Label htmlFor="wf-describe" className="text-[13px]">
          Describe what should happen
        </Label>
        <Textarea id="wf-describe" className="min-h-28" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={EXAMPLE} maxLength={4000} aria-invalid={!!generate.fieldErrors.description} />
        {generate.fieldErrors.description && <p className="text-xs text-danger-text">{generate.fieldErrors.description}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="text-xs text-brand hover:underline" onClick={() => setDescription(EXAMPLE)}>
            Use an example
          </button>
          <Button type="submit" disabled={generate.pending}>
            {generate.pending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />} {draft ? "Generate again" : "Generate draft"}
          </Button>
        </div>
      </form>

      {draft && (
        <section className="grid gap-4 rounded-2xl border bg-surface p-6 shadow-card" aria-labelledby="draft-title" aria-live="polite">
          <div>
            <p className="text-eyebrow text-ai">{draft.source === "ai" ? "Drafted by AI" : "Closest template"} · preview</p>
            <h2 id="draft-title" className="text-section-title">
              {draft.name}
            </h2>
            {draft.summary && <p className="mt-1 text-[13.5px] text-text-secondary">{draft.summary}</p>}
          </div>
          <div className="h-[340px] overflow-hidden rounded-xl border bg-background">
            <RunGraphLoader graph={draft.graph} statuses={{}} />
          </div>
          <ul className="grid gap-1.5 text-[12.5px]">
            {draft.notes.map((n) => (
              <li key={n} className="flex gap-2 text-text-secondary">
                <Info className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden /> {n}
              </li>
            ))}
            {errors.map((e, i) => (
              <li key={i} className="flex gap-2 text-warning-text">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {e.message} <span className="text-text-muted">(fix it in the builder)</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid min-w-[240px] flex-1 gap-1.5">
              <Label htmlFor="wf-gen-name" className="text-[13px]">
                Name
              </Label>
              <Input id="wf-gen-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>
            <Button onClick={() => void create.run({ name, description: draft.summary || undefined, graph: draft.graph, templateKey: draft.templateKey })} disabled={create.pending || !name.trim()}>
              {create.pending && <Loader2 className="animate-spin" aria-hidden />} Create as draft
            </Button>
          </div>
          <p className="text-xs text-text-muted">It opens in the builder as a draft. Nothing runs until you test and publish it.</p>
        </section>
      )}
    </div>
  );
}
