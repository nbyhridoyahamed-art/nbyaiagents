"use client";

import Link from "next/link";
import { useState } from "react";
import { Building2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/forms/field";
import { ConfirmButton } from "@/components/common/confirm-button";
import { EmptyState } from "@/components/common/empty-state";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { DEPARTMENT_ICONS, DepartmentIcon } from "@/components/departments/department-icon";
import { AVATAR_COLORS } from "@/lib/agents/schema";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import type { AgentStatus } from "@/lib/generated/prisma/enums";
import { deleteDepartmentAction, saveDepartmentAction } from "./actions";

interface Dept {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  counts: { agents: number; workflows: number; openTasks: number; knowledge: number; policies: number };
  agents: { id: string; name: string; color: string; status: AgentStatus }[];
}

export function DepartmentsView({ departments, canManage }: { departments: Dept[]; canManage: boolean }) {
  const [editing, setEditing] = useState<Dept | "new" | null>(null);
  const remove = useAction(deleteDepartmentAction, { success: "Department removed." });

  return (
    <>
      {canManage && (
        <div className="mb-5 flex justify-end">
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden /> New department
          </Button>
        </div>
      )}
      {departments.length === 0 ? (
        <EmptyState icon={Building2} title="No departments" description="Departments group AI employees, workflows and knowledge." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {departments.map((d) => (
            <li key={d.id} className="flex flex-col rounded-xl border bg-surface p-5 shadow-card">
              <div className="flex items-start gap-3">
                <DepartmentIcon icon={d.icon} color={d.color} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-card-title">{d.name}</h2>
                  <p className="line-clamp-2 text-[13px] text-text-secondary">{d.description || "No description."}</p>
                </div>
                {canManage && (
                  <div className="flex">
                    <Button variant="ghost" size="icon-sm" onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`}>
                      <Pencil aria-hidden />
                    </Button>
                    <ConfirmButton
                      variant="ghost"
                      size="icon-sm"
                      destructive
                      title={`Remove ${d.name}?`}
                      description="Its employees and workflows stay, but become unassigned. Department knowledge access is removed."
                      confirmLabel="Remove"
                      onConfirm={() => remove.run(d.id)}
                    >
                      <Trash2 aria-hidden />
                      <span className="sr-only">Remove {d.name}</span>
                    </ConfirmButton>
                  </div>
                )}
              </div>
              <dl className="mt-4 grid grid-cols-4 gap-2 border-t pt-3 text-center">
                {[
                  ["Employees", d.counts.agents],
                  ["Workflows", d.counts.workflows],
                  ["Open tasks", d.counts.openTasks],
                  ["Knowledge", d.counts.knowledge],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dd className="text-[17px] font-semibold tabular-nums">{value}</dd>
                    <dt className="text-[11px] text-text-muted">{label}</dt>
                  </div>
                ))}
              </dl>
              {d.agents.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {d.agents.map((a) => (
                    <Link key={a.id} href={`/agents/${a.id}`} className="flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs hover:bg-surface-2">
                      <AgentAvatar name={a.name} color={a.color} size={18} />
                      {a.name}
                    </Link>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <DepartmentDialog key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function DepartmentDialog({ initial, onClose }: { initial: Dept | null; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [color, setColor] = useState(initial?.color ?? AVATAR_COLORS[0]);
  const [icon, setIcon] = useState(initial?.icon ?? "building-2");
  const save = useAction(saveDepartmentAction, { success: "Department saved.", onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit department" : "New department"}</DialogTitle>
          <DialogDescription>Departments can have their own knowledge, policies and approval rules.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run({ id: initial?.id, name, description, color, icon });
          }}
        >
          <FormError message={save.error && !save.fieldErrors.name ? save.error : null} />
          <Field label="Name" name="name" value={name} onChange={(e) => setName(e.target.value)} error={save.fieldErrors.name} maxLength={60} />
          <Field label="Description" name="description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Colour</legend>
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Colour ${c}`}
                  aria-pressed={color === c}
                  className={cn("size-7 rounded-full ring-offset-2 ring-offset-surface", color === c && "ring-2 ring-foreground")}
                  style={{ background: c }}
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Icon</legend>
            <div className="flex flex-wrap gap-2">
              {Object.keys(DEPARTMENT_ICONS).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIcon(key)}
                  aria-label={`Icon ${key}`}
                  aria-pressed={icon === key}
                  className={cn("rounded-[12px] p-0.5", icon === key && "ring-2 ring-brand")}
                >
                  <DepartmentIcon icon={key} color={color} size={32} />
                </button>
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.pending}>
              {save.pending && <Loader2 className="animate-spin" aria-hidden />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
