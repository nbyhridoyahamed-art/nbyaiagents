"use client";

import { useState } from "react";
import { Field, FormError } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { COMPANY_SIZES, INDUSTRIES } from "@/lib/onboarding";
import { useAction } from "@/hooks/use-action";
import { updateCompanyAction } from "./actions";

interface CompanyValues {
  name: string;
  industry: string;
  companySize: string;
  website: string;
  description: string;
  timezone: string;
  monthlyAiBudgetUsd: number;
}

export function CompanyForm({
  initial,
  timezones,
  canEdit,
  slug,
  plan,
}: {
  initial: CompanyValues;
  timezones: string[];
  canEdit: boolean;
  slug: string;
  plan: string;
}) {
  const [values, setValues] = useState(initial);
  const { run, pending, fieldErrors, error } = useAction(updateCompanyAction, { success: "Company settings saved." });
  const set = <K extends keyof CompanyValues>(key: K, value: CompanyValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void run(values);
      }}
    >
      <section className="rounded-xl border bg-surface p-5 shadow-card sm:p-6">
        <h2 className="text-card-title">Company profile</h2>
        <p className="text-[13px] text-text-secondary">Your AI employees receive this as company context.</p>
        <div className="mt-5 grid gap-4">
          <FormError message={error && !Object.keys(fieldErrors).length ? error : null} />
          <Field label="Company name" name="name" value={values.name} onChange={(e) => set("name", e.target.value)} error={fieldErrors.name} disabled={!canEdit} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-[13px]">Industry</Label>
              <Select value={values.industry} onValueChange={(v) => set("industry", v)} disabled={!canEdit}>
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
              <Select value={values.companySize} onValueChange={(v) => set("companySize", v)} disabled={!canEdit}>
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
          <Field label="Website" name="website" type="url" value={values.website} onChange={(e) => set("website", e.target.value)} error={fieldErrors.website} disabled={!canEdit} />
          <div className="grid gap-1.5">
            <Label htmlFor="company-description" className="text-[13px]">
              What does your company do?
            </Label>
            <textarea
              id="company-description"
              className="min-h-24 rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              value={values.description}
              maxLength={2000}
              onChange={(e) => set("description", e.target.value)}
              disabled={!canEdit}
              placeholder="A short description your AI employees can rely on."
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-surface p-5 shadow-card sm:p-6">
        <h2 className="text-card-title">Operations</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-[13px]">Timezone</Label>
            <Select value={values.timezone} onValueChange={(v) => set("timezone", v)} disabled={!canEdit}>
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
            <p className="text-xs text-text-muted">Schedules and “today” metrics use this timezone.</p>
          </div>
          <Field
            label="Monthly AI budget (USD)"
            name="monthlyAiBudgetUsd"
            type="number"
            min={0}
            step={1}
            value={String(values.monthlyAiBudgetUsd)}
            onChange={(e) => set("monthlyAiBudgetUsd", Number(e.target.value))}
            error={fieldErrors.monthlyAiBudgetUsd}
            hint="Used for usage warnings. Costs are estimates based on provider list prices."
            disabled={!canEdit}
          />
        </div>
        <dl className="mt-5 grid gap-3 border-t pt-4 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="text-text-muted">Workspace ID</dt>
            <dd className="font-mono text-xs">{slug}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Plan</dt>
            <dd className="capitalize">{plan.toLowerCase()}</dd>
          </div>
        </dl>
      </section>

      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Save changes
          </Button>
        </div>
      ) : (
        <p className="text-[13px] text-text-muted">Only owners and admins can change company settings.</p>
      )}
    </form>
  );
}
