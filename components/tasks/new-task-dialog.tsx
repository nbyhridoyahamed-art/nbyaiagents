"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormError } from "@/components/forms/field";
import { useAction } from "@/hooks/use-action";
import { createTaskAction } from "@/app/(app)/tasks/actions";

export function NewTaskDialog({
  agents,
  defaultAgentId,
  trigger,
}: {
  agents: { id: string; name: string; jobTitle: string; published: boolean }[];
  defaultAgentId?: string;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ title: "", description: "", agentId: defaultAgentId ?? agents[0]?.id ?? "", priority: "MEDIUM", dueAt: "", simulate: false, runNow: true });
  const selected = agents.find((a) => a.id === v.agentId);
  const create = useAction(createTaskAction, {
    success: v.runNow ? "Task assigned — work has started." : "Task created.",
    onSuccess: (d) => {
      setOpen(false);
      router.push(`/tasks/${d.id}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="lg">
            <Plus aria-hidden /> New task
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Give an AI employee work</DialogTitle>
          <DialogDescription>Tasks run in the background. You&apos;ll be asked to approve anything that needs it.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create.run({
              title: v.title,
              description: v.description,
              agentId: v.agentId || null,
              priority: v.priority as "MEDIUM",
              dueAt: v.dueAt || null,
              mode: v.simulate ? "SIMULATION" : "LIVE",
              runNow: v.runNow,
            });
          }}
        >
          <FormError message={create.error && !Object.keys(create.fieldErrors).length ? create.error : null} />
          <Field label="Task" name="title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} error={create.fieldErrors.title} placeholder="Qualify yesterday's new leads" autoFocus />
          <Field label="Details (optional)" name="description" multiline rows={3} defaultValue={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="Context, inputs and what a good result looks like." />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-[13px]">Assign to</Label>
              <Select value={v.agentId || "none"} onValueChange={(val) => setV({ ...v, agentId: val === "none" ? "" : val })}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {a.jobTitle}
                      {!a.published ? " (draft)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[13px]">Priority</Label>
              <Select value={v.priority} onValueChange={(val) => setV({ ...v, priority: val })}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
                    <SelectItem key={p} value={p}>
                      {p.charAt(0) + p.slice(1).toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Field label="Deadline (optional)" name="dueAt" type="datetime-local" value={v.dueAt} onChange={(e) => setV({ ...v, dueAt: e.target.value })} error={create.fieldErrors.dueAt} />
          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={v.runNow} onCheckedChange={(c) => setV({ ...v, runNow: !!c })} disabled={!v.agentId} /> Start work immediately
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={v.simulate || (!!selected && !selected.published)} onCheckedChange={(c) => setV({ ...v, simulate: !!c })} disabled={!!selected && !selected.published} />
              Simulation — preview actions without executing them
              {selected && !selected.published && <span className="text-xs text-text-muted">(required for draft employees)</span>}
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.pending}>
              {create.pending && <Loader2 className="animate-spin" aria-hidden />}
              {v.runNow && v.agentId ? "Assign & start" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
