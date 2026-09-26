"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/forms/field";
import { useAction } from "@/hooks/use-action";
import { createCollectionAction } from "./actions";

const SUGGESTIONS = ["Company Information", "Brand Guidelines", "Product Documentation", "Pricing", "Sales SOP", "Support FAQ", "Refund Policy", "Internal Procedures"];

export function NewCollectionDialog({ label = "New collection" }: { label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"RESTRICTED" | "ORGANIZATION">("RESTRICTED");
  const create = useAction(createCollectionAction, {
    success: "Collection created.",
    onSuccess: (d) => {
      setOpen(false);
      router.push(`/knowledge/${d.id}`);
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg">
          <Plus aria-hidden /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New knowledge collection</DialogTitle>
          <DialogDescription>Group related documents, then choose who may read them.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create.run({ name, description, visibility });
          }}
        >
          <Field label="Name" name="name" value={name} onChange={(e) => setName(e.target.value)} error={create.fieldErrors.name} autoFocus />
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => setName(s)} className="rounded-full border px-2.5 py-0.5 text-xs text-text-secondary hover:bg-surface-2">
                {s}
              </button>
            ))}
          </div>
          <Field label="Description (optional)" name="description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium">Who can read it?</legend>
            <RadioGroup value={visibility} onValueChange={(v) => setVisibility(v as typeof visibility)}>
              <Label className="flex items-start gap-2 rounded-lg border p-3 font-normal">
                <RadioGroupItem value="RESTRICTED" className="mt-0.5" />
                <span>
                  <span className="block text-[13.5px] font-medium">Only employees and departments I choose</span>
                  <span className="block text-xs text-text-muted">Recommended for sensitive material.</span>
                </span>
              </Label>
              <Label className="flex items-start gap-2 rounded-lg border p-3 font-normal">
                <RadioGroupItem value="ORGANIZATION" className="mt-0.5" />
                <span>
                  <span className="block text-[13.5px] font-medium">Every AI employee</span>
                  <span className="block text-xs text-text-muted">For general company information.</span>
                </span>
              </Label>
            </RadioGroup>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.pending}>
              {create.pending && <Loader2 className="animate-spin" aria-hidden />} Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
