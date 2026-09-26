import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, CheckCircle2, Keyboard, Plug, ShieldCheck, Sparkles, Users, Workflow } from "lucide-react";
import { requirePageContext } from "@/lib/auth/context";
import { PageContainer, PageHeader } from "@/components/layout/page";

export const metadata: Metadata = { title: "Help" };

const STEPS = [
  { title: "Hire an AI employee", body: "Start from a template, describe the role to Ask NBY AI, or build one step by step. Every employee starts as a draft.", href: "/agents/new", icon: Users },
  { title: "Give them knowledge", body: "Upload policies, product sheets and SOPs. Employees cite what they use, and only see collections you allow.", href: "/knowledge", icon: BookOpen },
  { title: "Connect tools and set permissions", body: "Connect integrations, then decide per employee what's allowed, what needs your approval and what's blocked.", href: "/integrations", icon: Plug },
  { title: "Automate with a workflow", body: "Describe a process, install a template or build it visually. Test it with a simulation, then publish.", href: "/workflows/new", icon: Workflow },
  { title: "Stay in control", body: "Approve actions in Approvals, answer questions in the Inbox, and follow everything on the dashboard.", href: "/approvals", icon: CheckCircle2 },
];

const FAQ: [string, React.ReactNode][] = [
  [
    "What does “simulated” mean?",
    "Mock integrations (Mock CRM, Mock Email, …) never contact the outside world: emails are recorded in a mock outbox, not delivered. Simulation runs of workflows preview every step without real side effects and assume approvals. Both are always labelled.",
  ],
  [
    "Why did an employee answer “I couldn't find approved company knowledge”?",
    "Without a connected AI provider, employees run on the offline demo model, which only retrieves knowledge and follows simple rules. It says so rather than guessing. Connect a provider in Settings → AI providers for full reasoning.",
  ],
  [
    "Can an employee do something it isn't allowed to?",
    "No. Permissions, company policies and approval rules are checked on the server for every tool call — the AI can't talk its way around them, and instructions found inside documents, emails or web pages are treated as untrusted data.",
  ],
  [
    "What happens when an action needs approval?",
    "The work pauses and the request appears in Approvals, showing exactly what will happen. You can approve, edit then approve, or reject. Rejected actions never run, and the employee is told why.",
  ],
  [
    "How do I stop an employee mid-task?",
    "Open the task and choose Cancel, or Take over to finish it yourself. You can also pause an employee from their workspace.",
  ],
  [
    "Where do the dashboard numbers come from?",
    "Everything is measured from recorded runs, tasks and usage. Costs are estimates from token counts and each model's list price. Nothing is extrapolated, and there are no “hours saved” guesses.",
  ],
];

export default async function HelpPage() {
  const ctx = await requirePageContext();
  return (
    <PageContainer className="max-w-[1100px]">
      <PageHeader title="Help" description="How NBY AI Agents works, and how to get your AI company running." />

      <section aria-labelledby="start" className="mb-8">
        <h2 id="start" className="text-section-title">
          Getting started
        </h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Link href={s.href} className="flex h-full gap-3 rounded-[14px] border bg-surface p-4 shadow-card hover:border-border-strong">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                  <s.icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold">
                    {i + 1}. {s.title}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-text-secondary">{s.body}</span>
                </span>
                <ArrowRight className="ml-auto mt-1 size-4 shrink-0 text-text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section aria-labelledby="faq" className="rounded-[14px] border bg-surface p-5 shadow-card">
          <h2 id="faq" className="text-card-title">
            Common questions
          </h2>
          <div className="mt-2 divide-y">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-3">
                <summary className="cursor-pointer list-none text-[14px] font-medium marker:hidden group-open:text-brand">{q}</summary>
                <p className="mt-2 text-[13.5px] leading-relaxed text-text-secondary">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <div className="grid content-start gap-6">
          <section aria-labelledby="keys" className="rounded-[14px] border bg-surface p-5 shadow-card">
            <h2 id="keys" className="flex items-center gap-2 text-card-title">
              <Keyboard className="size-4 text-text-muted" aria-hidden /> Shortcuts
            </h2>
            <dl className="mt-3 grid gap-2 text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <dt>Search and commands</dt>
                <dd>
                  <kbd className="rounded border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">Ctrl</kbd> / <kbd className="rounded border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">⌘</kbd> +{" "}
                  <kbd className="rounded border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">K</kbd>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-ai" aria-hidden /> Ask NBY AI
                </dt>
                <dd className="text-text-secondary">button at the bottom right, or from search</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt>Skip to content</dt>
                <dd>
                  <kbd className="rounded border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">Tab</kbd> on any page
                </dd>
              </div>
            </dl>
          </section>
          <section aria-labelledby="dev" className="rounded-[14px] border bg-surface p-5 shadow-card">
            <h2 id="dev" className="flex items-center gap-2 text-card-title">
              <ShieldCheck className="size-4 text-text-muted" aria-hidden /> For developers
            </h2>
            <p className="mt-2 text-[13px] text-text-secondary">
              Give employees work and run workflows from other systems with scoped API keys and signed webhooks.
              {ctx.can("apikeys:manage") ? (
                <>
                  {" "}
                  <Link href="/settings/api-keys" className="text-brand hover:underline">
                    API keys & reference
                  </Link>
                </>
              ) : (
                " Ask an admin for an API key."
              )}
            </p>
          </section>
          <section aria-labelledby="office" className="rounded-[14px] border bg-surface p-5 shadow-card">
            <h2 id="office" className="text-card-title">
              See your whole team
            </h2>
            <p className="mt-2 text-[13px] text-text-secondary">
              The{" "}
              <Link href="/office" className="text-brand hover:underline">
                AI Office
              </Link>{" "}
              maps departments, who is working on what, who hands work to whom and which workflows connect them.
            </p>
          </section>
        </div>
      </div>
    </PageContainer>
  );
}
