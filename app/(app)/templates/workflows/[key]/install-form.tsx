"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { checkTemplateAction, installWorkflowTemplateAction } from "../../actions";

const HIRE = "hire";

interface Props {
  template: { key: string; name: string; stages: string[]; roles: { key: string; label: string; description: string; agentTemplate: string; hireTitle: string }[] };
  agents: { id: string; name: string; jobTitle: string; templateKey: string | null; draft: boolean }[];
}

export function InstallForm({ template, agents }: Props) {
  const router = useRouter();
  // Default each role to an employee hired from the matching template, else offer to hire one.
  const [roles, setRoles] = useState<Record<string, string>>(() =>
    Object.fromEntries(template.roles.map((r) => [r.key, agents.find((a) => a.templateKey === r.agentTemplate)?.id ?? HIRE])),
  );
  const [name, setName] = useState(template.name);
  const [notes, setNotes] = useState<string[] | null>(null);
  const install = useAction(installWorkflowTemplateAction, { refresh: false });
  const rolesKey = JSON.stringify(roles);

  useEffect(() => {
    let cancelled = false;
    void checkTemplateAction({ templateKey: template.key, roles: JSON.parse(rolesKey) }).then((r) => !cancelled && r.ok && setNotes(r.data.notes));
    return () => {
      cancelled = true;
    };
  }, [rolesKey, template.key]);

  const labelFor = (value: string | undefined, hireTitle: string) => {
    if (!value || value === HIRE) return `Hire a new ${hireTitle} from the template`;
    const a = agents.find((x) => x.id === value);
    return a ? `${a.name} · ${a.jobTitle}${a.draft ? " (draft)" : ""}` : "Choose an employee";
  };

  const hiring = useMemo(() => template.roles.filter((r) => roles[r.key] === HIRE), [roles, template.roles]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await install.run({ templateKey: template.key, name, roles });
    if (!res.ok) return;
    toast.success("Installed as a draft. Test it, then publish when you're happy.", { duration: 6000 });
    for (const n of res.data.notes) toast.info(n, { duration: 9000 });
    router.push(`/workflows/${res.data.workflowId}`);
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <section className="rounded-[14px] border bg-surface p-5 shadow-card">
        <h2 className="text-card-title">How it works</h2>
        <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-[12.5px]">
          {template.stages.map((s, i) => (
            <li key={s} className="flex items-center gap-1.5">
              {i > 0 && <ArrowRight className="size-3 text-text-muted" aria-hidden />}
              <span className="rounded-md border bg-surface-2 px-2 py-0.5 font-medium">{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 rounded-[14px] border bg-surface p-5 shadow-card">
        <div className="grid gap-1.5">
          <Label htmlFor="wf-name">Workflow name</Label>
          <Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        {template.roles.map((r) => (
          <div key={r.key} className="grid gap-1.5">
            <Label htmlFor={`role-${r.key}`}>{r.label}</Label>
            <p className="-mt-1 text-xs text-text-muted">{r.description}</p>
            <Select value={roles[r.key]} onValueChange={(v) => setRoles((prev) => ({ ...prev, [r.key]: v }))}>
              <SelectTrigger id={`role-${r.key}`} className="w-full">
                {/* Explicit label: Radix only knows item text after the list has rendered once. */}
                <SelectValue>{labelFor(roles[r.key], r.hireTitle)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={HIRE}>Hire a new {r.hireTitle} from the template</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {a.jobTitle}
                    {a.draft ? " (draft)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {install.fieldErrors[`roles.${r.key}`] && <p className="text-xs text-danger-text">{install.fieldErrors[`roles.${r.key}`]}</p>}
          </div>
        ))}
      </section>

      <section className="rounded-[14px] border bg-surface p-5 shadow-card" aria-live="polite">
        <h2 className="text-card-title">Before you run it</h2>
        <ul className="mt-3 grid gap-2 text-[13px]">
          <li className="flex gap-2">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            It installs as a <strong className="font-semibold">draft</strong>. Customize it in the builder, run a test, then publish.
          </li>
          {hiring.length > 0 && (
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              New draft employee{hiring.length === 1 ? "" : "s"} will be hired for: {hiring.map((h) => h.label).join(", ")}. Review and publish them before running live.
            </li>
          )}
          {notes === null ? (
            <li className="flex items-center gap-2 text-text-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Checking your setup…
            </li>
          ) : (
            notes.map((n) => (
              <li key={n} className="flex gap-2 text-warning-text">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {n}
              </li>
            ))
          )}
        </ul>
      </section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.push("/templates?tab=workflows")}>
          Cancel
        </Button>
        <Button type="submit" disabled={install.pending}>
          {install.pending ? <Loader2 className="animate-spin" aria-hidden /> : null} Install as draft
        </Button>
      </div>
    </form>
  );
}
