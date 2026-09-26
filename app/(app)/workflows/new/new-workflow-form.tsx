"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormError } from "@/components/forms/field";
import { useAction } from "@/hooks/use-action";
import { createWorkflowAction } from "../actions";

export function NewWorkflowForm({ departments }: { departments: { id: string; name: string }[] }) {
  const router = useRouter();
  const [v, setV] = useState({ name: "", description: "", departmentId: "" });
  const create = useAction(createWorkflowAction, { refresh: false, onSuccess: (d) => router.push(`/workflows/${d.id}`) });
  return (
    <form
      className="grid gap-4 rounded-2xl border bg-surface p-6 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        void create.run({ name: v.name, description: v.description, departmentId: v.departmentId || null });
      }}
    >
      <FormError message={create.error && !create.fieldErrors.name ? create.error : null} />
      <Field label="Name" name="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={create.fieldErrors.name} placeholder="Lead Outreach" autoFocus />
      <Field label="What does it do? (optional)" name="description" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="Research, score and contact new website leads." />
      <div className="grid gap-1.5">
        <Label className="text-[13px]">Department (optional)</Label>
        <Select value={v.departmentId || "none"} onValueChange={(d) => setV({ ...v, departmentId: d === "none" ? "" : d })}>
          <SelectTrigger className="h-10 w-full sm:w-72">
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
      <Button type="submit" size="lg" className="justify-self-end" disabled={create.pending}>
        {create.pending && <Loader2 className="animate-spin" aria-hidden />} Continue to builder
      </Button>
    </form>
  );
}
