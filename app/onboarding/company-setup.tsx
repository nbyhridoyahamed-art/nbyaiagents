"use client";

import { useState, useTransition } from "react";
import { useBrowserTimezone } from "@/hooks/use-browser";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Building2, Check, Loader2, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/forms/field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BUSINESS_GOALS, COMPANY_SIZES, INDUSTRIES } from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { createCompanyAction } from "./actions";

const STEPS = ["Welcome", "Company", "Goals"] as const;

export function CompanySetup({ userName, timezones }: { userName: string; timezones: string[] }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [website, setWebsite] = useState("");
  const browserTz = useBrowserTimezone();
  const [chosenTimezone, setTimezone] = useState<string | null>(null);
  const timezone = chosenTimezone ?? (timezones.includes(browserTz) ? browserTz : "UTC");
  const [goals, setGoals] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const reduce = useReducedMotion();

  function next() {
    if (step === 1 && name.trim().length < 2) {
      setFieldErrors({ name: "Enter your company name." });
      return;
    }
    setFieldErrors({});
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createCompanyAction({ name, industry, companySize, website, timezone, businessGoals: goals });
      if (res && !res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        if (res.fieldErrors?.name || res.fieldErrors?.website || res.fieldErrors?.timezone) setStep(1);
      }
    });
  }

  return (
    <div>
      <ol className="mb-6 flex items-center gap-2" aria-label="Setup progress">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                i < step ? "bg-brand text-white" : i === step ? "bg-brand-soft text-brand-hover ring-1 ring-brand" : "bg-surface-2 text-text-muted",
              )}
              aria-current={i === step ? "step" : undefined}
            >
              {i < step ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span className={cn("text-small", i === step ? "text-foreground" : "text-text-muted")}>{label}</span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>

      <div className="rounded-2xl border bg-surface p-6 shadow-card sm:p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {step === 0 && (
              <div>
                <span className="inline-flex size-11 items-center justify-center rounded-xl bg-ai-soft text-ai">
                  <Sparkles className="size-5" aria-hidden />
                </span>
                <h1 className="mt-4 text-[26px] font-semibold leading-9 tracking-tight">
                  Welcome{userName ? `, ${userName}` : ""}. Let&apos;s build your AI company.
                </h1>
                <p className="mt-2 text-text-secondary">
                  You&apos;re the owner. Your AI employees do the work — with the knowledge, tools and rules you give them.
                  You stay in control of anything sensitive.
                </p>
                <ul className="mt-5 grid gap-2.5 text-[13px] text-text-secondary">
                  {[
                    "Set up your company workspace",
                    "Hire your first AI employees",
                    "Give them knowledge and connect their tools",
                    "Automate your first workflow — with approvals where it matters",
                  ].map((t) => (
                    <li key={t} className="flex items-center gap-2">
                      <Check className="size-4 text-success" aria-hidden /> {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {step === 1 && (
              <div className="grid gap-4">
                <div>
                  <Building2 className="size-5 text-brand" aria-hidden />
                  <h2 className="mt-2 text-section-title">Your company</h2>
                  <p className="text-text-secondary">This helps your AI employees understand who they work for.</p>
                </div>
                <FormError message={error && step === 1 ? error : null} />
                <Field
                  label="Company name"
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  error={fieldErrors.name}
                  autoFocus
                  maxLength={80}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label className="text-[13px]">Industry</Label>
                    <Select value={industry} onValueChange={setIndustry}>
                      <SelectTrigger className="h-10 w-full" aria-label="Industry">
                        <SelectValue placeholder="Select industry" />
                      </SelectTrigger>
                      <SelectContent>
                        {INDUSTRIES.map((i) => (
                          <SelectItem key={i} value={i}>
                            {i}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-[13px]">Team size</Label>
                    <Select value={companySize} onValueChange={setCompanySize}>
                      <SelectTrigger className="h-10 w-full" aria-label="Team size">
                        <SelectValue placeholder="Select size" />
                      </SelectTrigger>
                      <SelectContent>
                        {COMPANY_SIZES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Field
                  label="Website (optional)"
                  name="website"
                  type="url"
                  placeholder="https://"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  error={fieldErrors.website}
                />
                <div className="grid gap-1.5">
                  <Label className="text-[13px]">Timezone</Label>
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger className="h-10 w-full" aria-label="Timezone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {timezones.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz.replaceAll("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-text-muted">Schedules run in this timezone.</p>
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                <Target className="size-5 text-brand" aria-hidden />
                <h2 className="mt-2 text-section-title">What should your AI workforce help with?</h2>
                <p className="text-text-secondary">Pick any that apply. We&apos;ll recommend AI employees based on these.</p>
                <FormError message={error} />
                <div className="mt-4 grid gap-2 sm:grid-cols-2" role="group" aria-label="Business goals">
                  {BUSINESS_GOALS.map((g) => {
                    const selected = goals.includes(g.key);
                    return (
                      <button
                        key={g.key}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setGoals((prev) => (selected ? prev.filter((x) => x !== g.key) : [...prev, g.key]))}
                        className={cn(
                          "flex items-center justify-between rounded-xl border px-3.5 py-3 text-left text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                          selected ? "border-brand bg-brand-soft text-brand-hover" : "hover:bg-surface-2",
                        )}
                      >
                        {g.label}
                        <span
                          className={cn(
                            "flex size-4.5 items-center justify-center rounded-full border",
                            selected ? "border-brand bg-brand text-white" : "border-border-strong",
                          )}
                          aria-hidden
                        >
                          {selected && <Check className="size-3" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-8 flex items-center justify-between">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={pending}>
              <ArrowLeft aria-hidden /> Back
            </Button>
          ) : (
            <span />
          )}
          {step < STEPS.length - 1 ? (
            <Button size="lg" onClick={next}>
              {step === 0 ? "Get started" : "Continue"} <ArrowRight aria-hidden />
            </Button>
          ) : (
            <Button size="lg" onClick={submit} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {pending ? "Creating workspace…" : "Create my AI company"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
