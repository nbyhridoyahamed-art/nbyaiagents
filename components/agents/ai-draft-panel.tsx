"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormError } from "@/components/forms/field";
import type { CreateAgentInput } from "@/lib/agents/schema";
import { generateAgentDraftAction } from "@/app/(app)/agents/actions";

const EXAMPLES = [
  "Create a customer support employee for my ecommerce company. It should answer product, order, shipping and refund questions and escalate complaints.",
  "A sales development rep who researches inbound leads, scores them against our ideal customer profile, and drafts personalised first emails for my approval.",
  "An executive assistant that triages my inbox every morning and prepares a short briefing.",
];

export function AiDraftPanel({ onBack, onDraft, initialText }: { onBack: () => void; onDraft: (input: CreateAgentInput) => void; initialText?: string }) {
  const [text, setText] = useState(initialText ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Arriving from "Ask NBY AI": draft straight away (still only a draft to review).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (initialText && initialText.trim().length >= 15 && !autoStarted.current) {
      autoStarted.current = true;
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  function generate() {
    setError(null);
    start(async () => {
      const res = await generateAgentDraftAction(text);
      if (!res.ok) {
        setError(res.fieldErrors?._form ?? res.error);
        return;
      }
      toast.info(res.data.notes, { duration: 8000 });
      onDraft(res.data.input);
    });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl border bg-surface p-6 shadow-card sm:p-8">
        <span className="inline-flex size-11 items-center justify-center rounded-xl bg-ai-soft text-ai">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <h2 className="mt-4 text-section-title">Describe the employee you need</h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          We&apos;ll draft the role, instructions, recommended knowledge, tools and permissions. Nothing is active until you review and hire.
        </p>
        <FormError message={error} />
        <Textarea className="mt-4 min-h-32" value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLES[0]} maxLength={3000} aria-label="Describe the employee" />
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setText(ex)} className="rounded-full border px-3 py-1 text-left text-xs text-text-secondary hover:bg-surface-2">
              {ex.slice(0, 60)}…
            </button>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" onClick={onBack} disabled={pending}>
            <ArrowLeft aria-hidden /> Back
          </Button>
          <Button size="lg" onClick={generate} disabled={pending || text.trim().length < 15}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
            {pending ? "Drafting…" : "Draft employee"}
          </Button>
        </div>
      </div>
    </div>
  );
}
