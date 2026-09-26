"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Sparkles, UserPlus, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const ASK_EVENT = "nby:ask";

const WORKFLOW_WORDS = /\b(workflow|automat\w*|whenever|every (day|week|monday|morning)|when (a|an|i|we|someone)|trigger|pipeline|then|after that|step)\b/i;
const EMPLOYEE_WORDS = /\b(employee|hire|assistant|agent|specialist|manager|representative|writer|recruiter|coordinator|analyst)\b/i;

/** Best guess of what the person wants — they always choose explicitly. */
export function guessIntent(text: string): "workflow" | "employee" | null {
  const w = WORKFLOW_WORDS.test(text);
  const e = EMPLOYEE_WORDS.test(text);
  if (w && !e) return "workflow";
  if (e && !w) return "employee";
  if (w && e) return /\b(build|create|set up)\b.{0,20}\b(workflow|automation)\b/i.test(text) ? "workflow" : "employee";
  return null;
}

const EXAMPLES = ["Create a customer support employee who answers from our refund policy.", "Build a lead generation workflow that researches new leads and asks me before emailing them."];

/**
 * "Ask NBY AI" (spec §102): describe what you want; it drafts an employee or a
 * workflow for review. It never publishes anything — you land on a draft.
 */
export function AskNby({ canHire, canBuild }: { canHire: boolean; canBuild: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const guess = useMemo(() => guessIntent(text), [text]);

  useEffect(() => {
    const onAsk = () => setOpen(true);
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, []);

  if (!canHire && !canBuild) return null;
  // The builder has its own canvas controls in that corner.
  const hideButton = /^\/workflows\/(?!new)[^/]+$/.test(pathname);

  function go(kind: "employee" | "workflow") {
    const q = encodeURIComponent(text.trim());
    setOpen(false);
    setText("");
    router.push(kind === "employee" ? `/agents/new?describe=${q}` : `/workflows/new?describe=${q}`);
  }

  const ready = text.trim().length >= 15;
  return (
    <>
      {!hideButton && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 z-30 inline-flex items-center gap-2 rounded-full bg-ai-solid px-4 py-2.5 text-[13px] font-semibold text-white shadow-pop transition-transform duration-150 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:bottom-6 md:right-6"
        >
          <Sparkles className="size-4" aria-hidden /> Ask NBY AI
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-ai" aria-hidden /> Ask NBY AI
            </DialogTitle>
            <DialogDescription>Describe an AI employee or a workflow. You&apos;ll get a draft to review — nothing is published or run until you decide.</DialogDescription>
          </DialogHeader>
          <Textarea autoFocus className="min-h-28" value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLES[0]} maxLength={3000} aria-label="What do you need?" />
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setText(ex)} className="rounded-full border px-3 py-1 text-left text-xs text-text-secondary hover:bg-surface-2">
                {ex.slice(0, 52)}…
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {canHire && (
              <Button variant={guess === "employee" ? "default" : "outline"} disabled={!ready} onClick={() => go("employee")} className={cn(guess === "employee" && "ring-2 ring-brand/30")}>
                <UserPlus aria-hidden /> Draft an AI employee
              </Button>
            )}
            {canBuild && (
              <Button variant={guess === "workflow" ? "default" : "outline"} disabled={!ready} onClick={() => go("workflow")} className={cn(guess === "workflow" && "ring-2 ring-brand/30")}>
                <Workflow aria-hidden /> Draft a workflow
              </Button>
            )}
          </div>
          {!ready && <p className="text-xs text-text-muted">Write a sentence or two first.</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
