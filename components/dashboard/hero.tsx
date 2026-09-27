import Link from "next/link";
import { Building, FlaskConical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DashboardSummary } from "@/server/services/dashboard";

function joinList(items: string[]) {
  const lower = items.map((d) => d.toLowerCase());
  if (lower.length <= 1) return lower[0] ?? "";
  return `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
}

export function CompanyHero({ summary, isDemo, canHire }: { summary: DashboardSummary; isDemo: boolean; canHire: boolean }) {
  const { agents, departments, attention } = summary;
  const headline = agents.working > 0 ? "Your AI workforce is working." : agents.total > 0 ? "Your AI workforce is ready." : "Build your AI workforce.";
  const body =
    agents.total === 0
      ? "Hire your first AI employee, give it knowledge and tools, and start assigning real work."
      : `${agents.total} AI employee${agents.total === 1 ? " is" : "s are"} helping run ${departments.length ? joinList(departments) : "your company"}.`;
  const stats = [
    agents.working > 0 && `${agents.working} working`,
    agents.scheduled > 0 && `${agents.scheduled} scheduled`,
    attention.total > 0 && `${attention.total} awaiting you`,
  ].filter(Boolean);

  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate overflow-hidden rounded-[20px] border bg-surface px-6 py-7 shadow-card md:px-8"
      style={{ minHeight: 180 }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,color-mix(in_oklab,var(--brand)_12%,transparent),transparent_60%)]" />
      <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,260px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-eyebrow text-brand">Your AI company</p>
            {isDemo && (
              <span className="inline-flex items-center gap-1 rounded-md bg-ai-soft px-1.5 py-0.5 text-[11px] font-semibold text-ai" title="This workspace was filled with sample records so you can explore. None of it came from real customers.">
                <FlaskConical className="size-3" aria-hidden /> Demo data
              </span>
            )}
          </div>
          <h1 id="hero-title" className="font-heading mt-2 text-[26px] font-[650] leading-9 tracking-tight lg:text-[30px] lg:leading-10">
            {headline}
          </h1>
          <p className="mt-2 max-w-xl text-[15px] text-text-secondary">{body}</p>
          {stats.length > 0 && <p className="mt-3 text-[13.5px] font-medium text-foreground">{stats.join(" · ")}</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            {agents.total > 0 ? (
              <Button asChild variant="outline">
                <Link href="/office">
                  <Building aria-hidden /> View AI Office
                </Link>
              </Button>
            ) : (
              canHire && (
                <Button asChild>
                  <Link href="/agents/new">
                    <Plus aria-hidden /> Hire AI Employee
                  </Link>
                </Button>
              )
            )}
            {attention.total > 0 && (
              <Button asChild variant="ghost">
                <Link href={attention.approvals > 0 ? "/approvals" : "/inbox"}>Review {attention.total} item{attention.total === 1 ? "" : "s"}</Link>
              </Button>
            )}
          </div>
        </div>
        <HeroNetwork />
      </div>
    </section>
  );
}

const NODES = [
  { id: "agent", x: 210, y: 90, r: 22, label: "Agent", color: "var(--brand)" },
  { id: "tool", x: 360, y: 44, r: 15, label: "Tool", color: "var(--info)" },
  { id: "workflow", x: 350, y: 146, r: 16, label: "Workflow", color: "var(--success)" },
  { id: "knowledge", x: 66, y: 52, r: 15, label: "Knowledge", color: "var(--ai)" },
  { id: "a2", x: 88, y: 146, r: 11, label: "", color: "var(--brand)" },
  { id: "t2", x: 280, y: 16, r: 7, label: "", color: "var(--info)" },
  { id: "k2", x: 150, y: 20, r: 6, label: "", color: "var(--ai)" },
];
const LINKS: [string, string][] = [
  ["agent", "tool"],
  ["agent", "workflow"],
  ["agent", "knowledge"],
  ["agent", "a2"],
  ["tool", "t2"],
  ["knowledge", "k2"],
  ["a2", "knowledge"],
  ["workflow", "tool"],
];

/** Abstract AI network (spec §76–77): SVG only, subtle 4–6s opacity pulses, no stock imagery. */
function HeroNetwork() {
  const at = (id: string) => NODES.find((n) => n.id === id)!;
  return (
    <svg viewBox="0 0 420 180" className="hidden h-[180px] w-full md:block" role="img" aria-label="Illustration: AI employees connected to tools, workflows and knowledge">
      {LINKS.map(([a, b], i) => {
        const p = at(a);
        const q = at(b);
        return (
          <line
            key={`${a}-${b}`}
            x1={p.x}
            y1={p.y}
            x2={q.x}
            y2={q.y}
            stroke="var(--border-strong)"
            strokeWidth={1.4}
            strokeDasharray="3 5"
            className="animate-network"
            style={{ animationDelay: `${(i % 4) * 1.1}s`, animationDuration: `${4 + (i % 3)}s` }}
          />
        );
      })}
      {NODES.map((n, i) => (
        <g key={n.id}>
          <circle cx={n.x} cy={n.y} r={n.r + 8} fill={n.color} opacity={0.08} className="animate-network" style={{ animationDelay: `${i * 0.7}s`, animationDuration: `${5 + (i % 2)}s` }} />
          <circle cx={n.x} cy={n.y} r={n.r} fill="var(--surface)" stroke={n.color} strokeWidth={2} />
          <circle cx={n.x} cy={n.y} r={Math.max(3, n.r / 3)} fill={n.color} />
          {n.label && (
            <text x={n.x} y={n.y + n.r + 16} textAnchor="middle" fontSize="11" fontWeight={600} fill="var(--text-secondary)">
              {n.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
