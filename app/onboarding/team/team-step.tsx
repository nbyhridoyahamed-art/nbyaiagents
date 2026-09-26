"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/forms/field";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { cn } from "@/lib/utils";
import { finishOnboardingAction } from "./actions";

interface Recommended {
  key: string;
  name: string;
  jobTitle: string;
  department: string;
  summary: string;
  color: string;
}

export function TeamStep({ companyName, recommended }: { companyName: string; recommended: Recommended[] }) {
  const [selected, setSelected] = useState<string[]>(recommended.slice(0, 4).map((r) => r.key));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function finish(keys: string[]) {
    setError(null);
    start(async () => {
      const res = await finishOnboardingAction({ templateKeys: keys });
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <div>
      <div className="mb-6">
        <span className="inline-flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Users className="size-5" aria-hidden />
        </span>
        <h1 className="mt-4 text-[26px] font-semibold leading-9 tracking-tight">Recommended AI employees for {companyName}</h1>
        <p className="mt-2 text-text-secondary">
          Based on your goals. They start as <strong className="font-medium text-foreground">drafts</strong> — you&apos;ll review
          their instructions, knowledge, tools and permissions before they do any live work.
        </p>
      </div>
      <FormError message={error} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2" role="group" aria-label="Recommended employees">
        {recommended.map((r) => {
          const isSelected = selected.includes(r.key);
          return (
            <button
              key={r.key}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelected((prev) => (isSelected ? prev.filter((k) => k !== r.key) : [...prev, r.key]))}
              className={cn(
                "relative flex gap-3 rounded-xl border bg-surface p-4 text-left shadow-card transition-all hover:-translate-y-px hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-ring",
                isSelected && "border-brand ring-1 ring-brand",
              )}
            >
              <AgentAvatar name={r.name} color={r.color} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block text-card-title">{r.name}</span>
                <span className="block text-xs text-text-muted">
                  {r.jobTitle} · {r.department}
                </span>
                <span className="mt-1.5 block text-[13px] text-text-secondary">{r.summary}</span>
              </span>
              <span
                className={cn(
                  "absolute right-3 top-3 flex size-5 items-center justify-center rounded-full border",
                  isSelected ? "border-brand bg-brand text-white" : "border-border-strong bg-surface",
                )}
                aria-hidden
              >
                {isSelected && <Check className="size-3.5" />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-8 flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" onClick={() => finish([])} disabled={pending}>
          Skip for now
        </Button>
        <Button size="lg" onClick={() => finish(selected)} disabled={pending || selected.length === 0}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {pending ? "Hiring…" : `Hire ${selected.length} AI employee${selected.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}
