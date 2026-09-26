import type { Metadata } from "next";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import { AGENT_TEMPLATES } from "@/lib/templates/agents";
import { WORKFLOW_TEMPLATES } from "@/lib/templates/workflows";
import { getDisabled } from "@/server/services/platform-settings";
import { CatalogToggle } from "./catalog-toggle";

export const metadata: Metadata = { title: "Integrations & templates" };

export default async function AdminCatalogPage() {
  const [integrations, templates] = await Promise.all([getDisabled("integrations.disabled"), getDisabled("templates.disabled")]);
  const sections = [
    {
      title: "Integrations",
      description: "Turned-off integrations can't be connected, and their tools are blocked for every company.",
      kind: "integrations" as const,
      items: INTEGRATIONS.map((i) => ({ key: i.key, name: i.name, detail: `${i.category} · ${i.availability.replace("_", " ")}${i.simulated ? " · simulated" : ""}`, disabled: integrations.includes(i.key) })),
    },
    {
      title: "Employee templates",
      description: "Turned-off templates are hidden from the gallery and can't be used to hire.",
      kind: "templates" as const,
      items: AGENT_TEMPLATES.map((t) => ({ key: t.key, name: t.jobTitle, detail: `v${t.version} · ${t.department}`, disabled: templates.includes(t.key) })),
    },
    {
      title: "Workflow templates",
      description: "Turned-off templates are hidden from the gallery and can't be installed.",
      kind: "templates" as const,
      items: WORKFLOW_TEMPLATES.map((t) => ({ key: t.key, name: t.name, detail: `v${t.version} · ${t.category}`, disabled: templates.includes(t.key) })),
    },
  ];
  return (
    <div className="grid gap-6">
      <h1 className="text-page-title">Integrations & templates</h1>
      {sections.map((s) => (
        <section key={s.title} className="rounded-[14px] border bg-surface shadow-card" aria-label={s.title}>
          <header className="border-b px-5 py-3">
            <h2 className="text-card-title">{s.title}</h2>
            <p className="text-xs text-text-muted">{s.description}</p>
          </header>
          <ul className="divide-y">
            {s.items.map((i) => (
              <li key={i.key} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium">{i.name}</p>
                  <p className="text-xs capitalize text-text-muted">{i.detail}</p>
                </div>
                <CatalogToggle kind={s.kind} itemKey={i.key} name={i.name} enabled={!i.disabled} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
