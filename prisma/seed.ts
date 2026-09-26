/**
 * Development seed: "NBY Demo Company" (spec §127–128).
 *
 *   npm run db:seed              # set up the demo workspace (safe to re-run)
 *   npm run db:seed -- --reset   # also rebuild the generated demo history
 *
 * How the demo stays honest:
 *  - The workspace is flagged `isDemo`; the UI labels it "Demo data".
 *  - Employees, workflows, knowledge and integrations are created through the real
 *    services. Workflows are simulated and published the normal way.
 *  - The items waiting for a human are REAL: employees run real tasks (offline demo
 *    model) and pause on real approvals; a workflow really pauses for review/input.
 *  - Only the historical volume (past tasks, past workflow runs, usage, a few feed
 *    entries and two in-progress runs) is bulk-inserted, and every such row carries a
 *    marker so `--reset` (or "Remove demo data") deletes exactly those rows.
 *  - All integrations are the simulated Mock ones — nothing leaves the platform.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { userActor, type Actor } from "@/lib/auth/actor";
import type { AgentStatus, RunStepType, StepStatus } from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { WorkflowGraph } from "@/lib/workflows/types";
import { startOfDayInTimeZone, startOfMonthInTimeZone } from "@/lib/time";
import { ensureDemoAdmin } from "@/scripts/create-demo-admin";
import { getAgentTemplate } from "@/lib/templates/agents";
import { connectIntegration } from "@/server/services/integrations";
import { createDepartment } from "@/server/services/departments";
import { addManualDocument, createKnowledgeBase } from "@/server/services/knowledge";
import { createAgentFromTemplate, publishAgent, setAgentDelegates, setAgentKnowledge, setAgentTools, templateToAgentInput, updateAgentProfile } from "@/server/services/agents";
import { createWorkflow, publishWorkflow, runWorkflowNow, simulateDraft } from "@/server/services/workflows";
import { createTask } from "@/server/services/tasks";
import { DEMO_ACTIVITY_ENTITY, DEMO_MARK, DEMO_TASK_INPUTS, DEMO_USAGE_MODEL, removeDemoHistory } from "@/server/services/demo";
import { registerAllJobHandlers } from "@/server/jobs/handlers";
import { drainJobs } from "@/server/jobs/queue";

const RESET = process.argv.includes("--reset");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Deterministic pseudo-random numbers so every seed produces the same data.
let rngState = 20260926;
function rand() {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
}
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

const DEPARTMENTS = [
  { name: "Sales", color: "#5B5FEF", icon: "trending-up", description: "Pipeline, outreach and qualification." },
  { name: "Marketing", color: "#F79009", icon: "megaphone", description: "Campaigns, content, SEO and social." },
  { name: "Support", color: "#12B76A", icon: "headphones", description: "Customer questions and order issues." },
  { name: "Research", color: "#7C5CFC", icon: "flask-conical", description: "Market, competitor and operations research." },
];

interface DemoAgent {
  name: string;
  template: string;
  jobTitle: string;
  dept: string;
  color: string;
  status: AgentStatus;
  activity: string;
  progress: number | null;
  completed: number;
  failed: number;
  todayCompleted: number;
  todayFailed: number;
  extraRunning: number;
  titles: string[];
}

// Spec §82 / §128 sample figures. "completed"/"failed" are all-time totals incl. today.
const AGENTS: DemoAgent[] = [
  {
    name: "Sarah", template: "sales-representative", jobTitle: "Sales Manager", dept: "Sales", color: "#5B5FEF",
    status: "WORKING", activity: "Qualifying 14 new leads", progress: 82, completed: 128, failed: 5, todayCompleted: 8, todayFailed: 0, extraRunning: 5,
    titles: ["Qualify inbound lead from {co}", "Research {co} before first call", "Update CRM notes for {co}", "Draft follow-up for {co}", "Score webinar sign-ups"],
  },
  {
    name: "Emma", template: "customer-support-agent", jobTitle: "Customer Support", dept: "Support", color: "#12B76A",
    status: "ACTIVE", activity: "Handling 6 conversations", progress: 64, completed: 214, failed: 4, todayCompleted: 11, todayFailed: 0, extraRunning: 4,
    titles: ["Answer refund question from {co}", "Look up order status for {co}", "Explain shipping times to {co}", "Resolve login issue for {co}", "Summarise support tickets"],
  },
  {
    name: "Alex", template: "seo-specialist", jobTitle: "SEO Specialist", dept: "Marketing", color: "#F79009",
    status: "WORKING", activity: "Analyzing 46 target keywords", progress: 58, completed: 93, failed: 9, todayCompleted: 4, todayFailed: 1, extraRunning: 2,
    titles: ["Audit meta descriptions", "Keyword research: AI onboarding", "Find internal-link gaps", "Review competitor rankings", "Suggest title tag fixes"],
  },
  {
    name: "David", template: "marketing-manager", jobTitle: "Marketing Manager", dept: "Marketing", color: "#EE46BC",
    status: "SCHEDULED", activity: "Preparing weekly campaign", progress: null, completed: 74, failed: 5, todayCompleted: 2, todayFailed: 0, extraRunning: 0,
    titles: ["Plan weekly campaign", "Summarise campaign results", "Draft newsletter outline", "Review ad copy variants"],
  },
  {
    name: "Maya", template: "research-assistant", jobTitle: "Research Analyst", dept: "Research", color: "#7C5CFC",
    status: "WORKING", activity: "Compiling a competitor pricing brief", progress: 41, completed: 57, failed: 3, todayCompleted: 2, todayFailed: 0, extraRunning: 1,
    titles: ["Profile competitor {co}", "Summarise industry report", "Collect pricing pages", "Research market size"],
  },
  {
    name: "Olivia", template: "content-writer", jobTitle: "Content Writer", dept: "Marketing", color: "#2E90FA",
    status: "WORKING", activity: "Drafting 3 blog posts on AI onboarding", progress: 36, completed: 48, failed: 4, todayCompleted: 1, todayFailed: 1, extraRunning: 1,
    titles: ["Draft blog post outline", "Write case study intro", "Proofread landing page", "Write product update post"],
  },
  {
    name: "Liam", template: "social-media-manager", jobTitle: "Social Media Manager", dept: "Marketing", color: "#0BA5EC",
    status: "WORKING", activity: "Scheduling next week's LinkedIn posts", progress: 70, completed: 61, failed: 2, todayCompleted: 2, todayFailed: 0, extraRunning: 1,
    titles: ["Write LinkedIn post", "Repurpose blog into thread", "Summarise engagement", "Draft event announcement"],
  },
  {
    name: "Noah", template: "project-manager", jobTitle: "Operations Coordinator", dept: "Research", color: "#667085",
    status: "WORKING", activity: "Updating the Q4 launch plan", progress: 23, completed: 39, failed: 2, todayCompleted: 1, todayFailed: 0, extraRunning: 1,
    titles: ["Update launch checklist", "Summarise weekly status", "Collect blockers from teams", "Prepare meeting agenda"],
  },
];

const DELEGATES: Record<string, string[]> = {
  Sarah: ["Maya"],
  David: ["Olivia", "Liam"],
  Alex: ["Olivia"],
  Emma: ["Noah"],
};

const COMPANIES = ["Globex", "Initech", "Umbrella", "Hooli", "Stark Industries", "Wayne Enterprises", "Acme Corp", "Soylent", "Vandelay", "Massive Dynamic", "Wonka", "Cyberdyne"];

const KNOWLEDGE = [
  {
    title: "Sales SOP",
    content:
      "Sales standard operating procedure.\n\nIdeal customer profile: B2B software companies with 20–500 employees.\n\nQualification: score every lead from 0 to 100. Qualified: 70 or higher. Nurture: 40–69. Archive: below 40.\n\nOutreach: every outbound email must be approved by a manager before it is sent. Never promise discounts that are not in the pricing sheet.\n\nFollow-up: follow up after 3 business days, at most twice.",
  },
  {
    title: "Refund policy",
    content:
      "Refund policy.\n\nCustomers can request a full refund within 30 days of purchase. After 30 days, refunds are pro-rated for annual plans only.\n\nRefunds above $100 require approval from a support manager.\n\nRefunds are returned to the original payment method within 5–10 business days.",
  },
  {
    title: "Brand voice guide",
    content:
      "Brand voice.\n\nWe are warm, clear and confident. Use short sentences and plain language. Avoid jargon and hype words like 'revolutionary'.\n\nAlways address the reader directly. Headlines use sentence case.",
  },
  {
    title: "SEO guidelines",
    content:
      "SEO guidelines.\n\nTarget one primary keyword per page. Titles under 60 characters, meta descriptions under 155 characters.\n\nEvery new article links to at least two related articles. Prefer search intent over keyword volume.",
  },
];

/**
 * Processes jobs until this org has nothing pending or running — including jobs a
 * running dev server claimed — so later writes don't race with in-flight work.
 */
async function settle(orgId: string, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await drainJobs(500);
    const busy = await prisma.job.count({ where: { orgId, status: { in: ["PENDING", "RUNNING"] }, runAt: { lte: new Date(Date.now() + 5_000) } } });
    if (busy === 0) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  log("warning: some background jobs were still running when the seed continued");
}

function log(msg: string) {
  console.log(`  ${msg}`);
}

async function ensureDepartments(actor: Actor) {
  const out: Record<string, string> = {};
  for (const d of DEPARTMENTS) {
    const existing = await prisma.department.findFirst({ where: { orgId: actor.orgId, name: d.name, deletedAt: null } });
    out[d.name] = existing?.id ?? (await createDepartment(actor, d)).id;
  }
  return out;
}

async function ensureIntegrations(actor: Actor) {
  for (const key of ["mock_crm", "mock_email", "mock_calendar", "mock_search", "mock_sheets", "mock_commerce"]) {
    const c = await prisma.integrationConnection.findFirst({ where: { orgId: actor.orgId, integrationKey: key } });
    if (!c || c.status !== "CONNECTED") await connectIntegration(actor, key);
  }
}

async function ensureKnowledge(actor: Actor) {
  let kb = await prisma.knowledgeBase.findFirst({ where: { orgId: actor.orgId, name: "Company Handbook", deletedAt: null } });
  if (!kb) {
    kb = await createKnowledgeBase(actor, { name: "Company Handbook", description: "Policies and playbooks every employee can use.", visibility: "ORGANIZATION" });
    for (const doc of KNOWLEDGE) await addManualDocument(actor, kb.id, doc);
  }
  return kb.id;
}

async function ensureAgents(actor: Actor, departments: Record<string, string>, kbId: string) {
  const ids: Record<string, string> = {};
  for (const a of AGENTS) {
    const overrides = { name: a.name, jobTitle: a.jobTitle, departmentId: departments[a.dept], avatarColor: a.color };
    const existing = await prisma.agent.findFirst({ where: { orgId: actor.orgId, name: a.name, deletedAt: null } });
    let id: string;
    if (existing) {
      // Bring an existing employee with this name in line with the demo profile.
      const input = await templateToAgentInput(actor.orgId, a.template, overrides);
      await updateAgentProfile(actor, existing.id, { jobTitle: input.jobTitle, departmentId: input.departmentId, avatarColor: input.avatarColor, description: input.description, mission: input.mission });
      await setAgentTools(actor, existing.id, input.tools ?? []);
      await prisma.agent.update({ where: { id: existing.id }, data: { templateKey: a.template, templateVersion: getAgentTemplate(a.template)?.version ?? 1 } });
      id = existing.id;
    } else {
      id = (await createAgentFromTemplate(actor, a.template, overrides)).id;
    }
    await setAgentKnowledge(actor, id, [kbId]);
    ids[a.name] = id;
  }
  // Who can hand work to whom (shown in the AI Office).
  for (const [from, to] of Object.entries(DELEGATES)) await setAgentDelegates(actor, ids[from], to.map((n) => ids[n]));
  for (const id of Object.values(ids)) await publishAgent(actor, id, "Demo setup");
  return ids;
}

function leadGenGraph(sarah: string): WorkflowGraph {
  return {
    nodes: [
      { key: "trigger", type: "trigger.manual", label: "New lead", config: { inputFields: ["lead.name", "lead.email", "lead.company"] }, position: { x: 0, y: 120 } },
      { key: "research", type: "tool.call", label: "Research company", config: { toolKey: "mock_search.company_profile", input: { company: "{{trigger.lead.company}}" }, agentId: sarah }, position: { x: 300, y: 120 } },
      { key: "qualify", type: "agent.run", label: "Qualify lead", config: { agentId: sarah, instructions: "Qualify this lead using the Sales SOP: {{trigger.lead.name}} from {{trigger.lead.company}}." }, position: { x: 600, y: 120 } },
      {
        key: "outreach",
        type: "tool.call",
        label: "Send outreach email",
        config: { toolKey: "mock_email.send_email", input: { to: "{{trigger.lead.email}}", subject: "Quick question for {{trigger.lead.company}}", body: "Hi {{trigger.lead.name}},\n\n{{nodes.qualify.text}}" }, agentId: sarah },
        position: { x: 900, y: 120 },
      },
    ],
    edges: [
      { key: "e1", source: "trigger", target: "research" },
      { key: "e2", source: "research", target: "qualify" },
      { key: "e3", source: "qualify", target: "outreach" },
    ],
  };
}

function supportGraph(emma: string): WorkflowGraph {
  return {
    nodes: [
      { key: "trigger", type: "trigger.manual", label: "Customer question", config: { inputFields: ["question", "customer_email"] }, position: { x: 0, y: 120 } },
      { key: "answer", type: "agent.run", label: "Answer from policy", config: { agentId: emma, instructions: "Answer this customer question using company policy: {{trigger.question}}" }, position: { x: 300, y: 120 } },
      {
        key: "draft",
        type: "tool.call",
        label: "Draft reply",
        config: { toolKey: "mock_email.draft_email", input: { to: "{{trigger.customer_email}}", subject: "Re: your question", body: "{{nodes.answer.text}}" }, agentId: emma },
        position: { x: 600, y: 120 },
      },
    ],
    edges: [
      { key: "e1", source: "trigger", target: "answer" },
      { key: "e2", source: "answer", target: "draft" },
    ],
  };
}

function seoGraph(alex: string): WorkflowGraph {
  return {
    nodes: [
      { key: "trigger", type: "trigger.manual", label: "Topic", config: { inputFields: ["topic"] }, position: { x: 0, y: 120 } },
      { key: "clarify", type: "human.input", label: "Keyword clarification", config: { question: "Which audience should Alex prioritise for “{{trigger.topic}}” — new visitors or existing customers?" }, position: { x: 300, y: 120 } },
      { key: "research", type: "agent.run", label: "Keyword research", config: { agentId: alex, instructions: "Research keywords for {{trigger.topic}}. Audience guidance: {{nodes.clarify.answer}}" }, position: { x: 600, y: 120 } },
    ],
    edges: [
      { key: "e1", source: "trigger", target: "clarify" },
      { key: "e2", source: "clarify", target: "research" },
    ],
  };
}

function reportGraph(david: string): WorkflowGraph {
  return {
    nodes: [
      { key: "trigger", type: "trigger.schedule", label: "Mondays 9:00", config: { cron: "0 9 * * 1" }, position: { x: 0, y: 120 } },
      { key: "report", type: "agent.run", label: "Prepare report", config: { agentId: david, instructions: "Prepare the weekly marketing report and a LinkedIn campaign draft following the brand voice guide." }, position: { x: 300, y: 120 } },
      { key: "review", type: "human.review", label: "Review campaign draft", config: { title: "LinkedIn campaign draft ready", content: "{{nodes.report.text}}" }, position: { x: 600, y: 120 } },
    ],
    edges: [
      { key: "e1", source: "trigger", target: "report" },
      { key: "e2", source: "report", target: "review" },
    ],
  };
}

const WORKFLOWS = [
  { name: "Lead Generation", dept: "Sales", agent: "Sarah", graph: leadGenGraph, sample: { lead: { name: "Dana Ortiz", email: "dana@initech.example", company: "Initech" } }, runs: 124, failed: 5, lastAgo: 2 * MIN },
  { name: "Customer Support", dept: "Support", agent: "Emma", graph: supportGraph, sample: { question: "How long do refunds take?", customer_email: "sam@globex.example" }, runs: 82, failed: 2, lastAgo: 5 * MIN },
  { name: "SEO Research", dept: "Marketing", agent: "Alex", graph: seoGraph, sample: { topic: "AI onboarding" }, runs: 41, failed: 4, lastAgo: 12 * MIN },
  { name: "Weekly Marketing Report", dept: "Marketing", agent: "David", graph: reportGraph, sample: {}, runs: 12, failed: 0, lastAgo: HOUR },
];

async function ensureWorkflows(actor: Actor, departments: Record<string, string>, agents: Record<string, string>) {
  const out: Record<string, { id: string; versionId: string | null; version: number | null }> = {};
  for (const w of WORKFLOWS) {
    let wf = await prisma.workflow.findFirst({ where: { orgId: actor.orgId, name: w.name, deletedAt: null } });
    if (!wf) {
      wf = await createWorkflow(actor, { name: w.name, departmentId: departments[w.dept], graph: w.graph(agents[w.agent]), settings: { defaultAgentId: agents[w.agent] } });
    }
    if (wf.status !== "ACTIVE") {
      // Draft → Test → Publish, exactly as a user would.
      const sim = await simulateDraft(actor, wf.id, w.sample);
      await settle(actor.orgId);
      const run = await prisma.workflowRun.findUniqueOrThrow({ where: { id: sim.id } });
      if (run.status === "COMPLETED") {
        await publishWorkflow(actor, wf.id);
        log(`workflow “${w.name}”: simulated and published`);
      } else {
        log(`workflow “${w.name}”: simulation ${run.status.toLowerCase()} (${run.error ?? "no error"}) — left as draft`);
      }
    }
    const published = await prisma.workflowVersion.findFirst({ where: { workflowId: wf.id, status: "PUBLISHED" } });
    out[w.name] = { id: wf.id, versionId: published?.id ?? null, version: published?.version ?? null };
  }
  return out;
}

/** Real work that ends waiting for a human: genuine approvals and input requests. */
async function createRealPendingWork(actor: Actor, agents: Record<string, string>, workflows: Awaited<ReturnType<typeof ensureWorkflows>>) {
  await createTask(actor, { title: "Send email to priya@globex.example about our partnership opportunity", agentId: agents.Sarah }, { run: true });
  await createTask(actor, { title: "Send email to marco@umbrella.example with our pricing", agentId: agents.Sarah }, { run: true });
  if (workflows["Weekly Marketing Report"].versionId) await runWorkflowNow(actor, workflows["Weekly Marketing Report"].id, {});
  if (workflows["SEO Research"].versionId) await runWorkflowNow(actor, workflows["SEO Research"].id, { topic: "AI onboarding for small teams" });
  await settle(actor.orgId);
}

/** Bulk historical volume, every row marked so it can be removed. */
async function createHistory(orgId: string, timeZone: string, agents: Record<string, string>, workflows: Awaited<ReturnType<typeof ensureWorkflows>>, userId: string) {
  const now = Date.now();
  const today = startOfDayInTimeZone(timeZone).getTime();
  const sinceToday = Math.max(now - today, 30 * MIN);
  const tasks: Prisma.TaskCreateManyInput[] = [];
  const title = (a: DemoAgent) => pick(a.titles).replace("{co}", pick(COMPANIES));

  for (const a of AGENTS) {
    const agentId = agents[a.name];
    const deptId = (await prisma.agent.findUniqueOrThrow({ where: { id: agentId }, select: { departmentId: true } })).departmentId;
    const base = { orgId, agentId, departmentId: deptId, inputs: DEMO_TASK_INPUTS, createdById: userId, mode: "LIVE" as const };
    const finished = (status: "COMPLETED" | "FAILED", at: number) => {
      const started = at - (2 + Math.floor(rand() * 20)) * MIN;
      tasks.push({
        ...base,
        title: title(a),
        status,
        progress: status === "COMPLETED" ? 100 : Math.floor(rand() * 80),
        currentStep: status === "COMPLETED" ? "Done" : "Failed",
        result: status === "COMPLETED" ? "Completed (demo history)." : null,
        error: status === "FAILED" ? "A tool kept failing, so the employee escalated instead of guessing (demo history)." : null,
        createdAt: new Date(started - MIN),
        startedAt: new Date(started),
        completedAt: new Date(at),
        updatedAt: new Date(at),
      });
    };
    // Earlier days (up to 60 days back) and today.
    for (let i = 0; i < a.completed - a.todayCompleted; i++) finished("COMPLETED", today - (1 + rand() * 59) * DAY);
    for (let i = 0; i < a.failed - a.todayFailed; i++) finished("FAILED", today - (1 + rand() * 59) * DAY);
    for (let i = 0; i < a.todayCompleted; i++) finished("COMPLETED", now - rand() * sinceToday);
    for (let i = 0; i < a.todayFailed; i++) finished("FAILED", now - rand() * sinceToday);
    // Other work in progress (older than the headline task).
    for (let i = 0; i < a.extraRunning; i++) {
      const started = now - (20 + rand() * 180) * MIN;
      const queued = rand() < 0.35;
      tasks.push({
        ...base,
        title: title(a),
        status: queued ? "QUEUED" : "RUNNING",
        progress: queued ? 0 : 5 + Math.floor(rand() * 80),
        currentStep: queued ? "Queued" : "Working",
        createdAt: new Date(started),
        startedAt: queued ? null : new Date(started),
        updatedAt: new Date(started),
      });
    }
  }
  await prisma.task.createMany({ data: tasks });
  log(`${tasks.length} historical and in-progress tasks`);

  // Headline task per employee (their "current activity"), newest of all.
  const headline: Record<string, string> = {};
  for (const a of AGENTS) {
    if (a.progress === null) continue;
    const t = await prisma.task.create({
      data: {
        orgId,
        agentId: agents[a.name],
        title: a.activity,
        status: "RUNNING",
        progress: a.progress,
        currentStep: "Working",
        inputs: DEMO_TASK_INPUTS,
        createdById: userId,
        startedAt: new Date(now - 25 * MIN),
        createdAt: new Date(now - 26 * MIN),
      },
    });
    headline[a.name] = t.id;
  }

  // Two in-progress runs with operational steps for the Live Work panel.
  const liveRuns: { agent: string; steps: [string, RunStepType, StepStatus][] }[] = [
    {
      agent: "Sarah",
      steps: [
        ["Search CRM", "TOOL_CALL", "SUCCEEDED"],
        ["Research company", "TOOL_CALL", "SUCCEEDED"],
        ["Retrieve Sales SOP", "KNOWLEDGE_SEARCH", "SUCCEEDED"],
        ["Score lead", "MODEL_CALL", "RUNNING"],
        ["Draft outreach email", "OUTPUT", "PENDING"],
      ],
    },
    {
      agent: "Alex",
      steps: [
        ["Load target keyword list", "TOOL_CALL", "SUCCEEDED"],
        ["Check search volumes", "TOOL_CALL", "SUCCEEDED"],
        ["Cluster keywords by intent", "MODEL_CALL", "RUNNING"],
        ["Write recommendations", "OUTPUT", "PENDING"],
      ],
    },
  ];
  const liveRunIds: Record<string, string> = {};
  for (const lr of liveRuns) {
    const run = await prisma.agentRun.create({
      data: {
        orgId,
        agentId: agents[lr.agent],
        taskId: headline[lr.agent],
        status: "RUNNING",
        mode: "LIVE",
        provider: "OFFLINE",
        model: "offline-demo",
        input: AGENTS.find((a) => a.name === lr.agent)!.activity,
        state: { demoSeed: DEMO_MARK },
        startedAt: new Date(now - 25 * MIN),
      },
    });
    await prisma.agentRunStep.createMany({
      data: lr.steps.map(([label, type, status], i) => ({
        orgId,
        runId: run.id,
        sequence: i + 1,
        type,
        label,
        status,
        createdAt: new Date(now - (25 - i * 4) * MIN),
        completedAt: status === "SUCCEEDED" ? new Date(now - (23 - i * 4) * MIN) : null,
      })),
    });
    liveRunIds[lr.agent] = run.id;
  }

  // Delegation: Maya is working on a sub-task Sarah handed her right now, and a
  // few completed handoffs from the past weeks.
  const child = (delegator: string, delegate: string, parentRunId: string | null, status: "RUNNING" | "COMPLETED", at: number, input: string) => ({
    orgId,
    agentId: agents[delegate],
    parentRunId,
    status,
    mode: "LIVE" as const,
    provider: "OFFLINE" as const,
    model: "offline-demo",
    input: `Delegated by ${delegator}: ${input}`,
    output: status === "COMPLETED" ? "Done (demo history)." : null,
    state: { demoSeed: DEMO_MARK },
    startedAt: new Date(at - 8 * MIN),
    completedAt: status === "COMPLETED" ? new Date(at) : null,
    createdAt: new Date(at - 8 * MIN),
  });
  if (liveRunIds.Sarah) await prisma.agentRun.create({ data: child("Sarah", "Maya", liveRunIds.Sarah, "RUNNING", now, "Research the pricing pages of 3 competitors for this lead") });
  for (const [delegator, delegate, count] of [["David", "Olivia", 6], ["David", "Liam", 4], ["Alex", "Olivia", 3], ["Emma", "Noah", 2]] as const) {
    for (let i = 0; i < count; i++) {
      const parent = await prisma.agentRun.create({
        data: { orgId, agentId: agents[delegator], status: "COMPLETED", mode: "LIVE", provider: "OFFLINE", model: "offline-demo", input: "Coordinate a sub-task (demo history)", state: { demoSeed: DEMO_MARK }, createdAt: new Date(now - (1 + rand() * 25) * DAY) },
      });
      await prisma.agentRun.create({ data: child(delegator, delegate, parent.id, "COMPLETED", parent.createdAt.getTime() + 20 * MIN, "Prepare a draft for review") });
    }
  }

  // Workflow run history (live runs only count toward performance).
  let wfRunCount = 0;
  for (const w of WORKFLOWS) {
    const info = workflows[w.name];
    if (!info.versionId || info.version === null) continue;
    const rows = [];
    for (let i = 0; i < w.runs; i++) {
      const at = i === 0 ? now - w.lastAgo : now - w.lastAgo - rand() * 45 * DAY;
      const failed = i > 0 && i <= w.failed;
      rows.push({
        orgId,
        workflowId: info.id,
        versionId: info.versionId,
        version: info.version,
        status: failed ? ("FAILED" as const) : ("COMPLETED" as const),
        mode: "LIVE" as const,
        trigger: w.name === "Weekly Marketing Report" ? ("SCHEDULE" as const) : ("MANUAL" as const),
        triggerPayload: { demoSeed: DEMO_MARK },
        state: {},
        progress: failed ? 50 : 100,
        stepCount: 3,
        error: failed ? "A step failed and was escalated (demo history)." : null,
        createdAt: new Date(at - 2 * MIN),
        startedAt: new Date(at - 2 * MIN),
        completedAt: new Date(at),
      });
    }
    await prisma.workflowRun.createMany({ data: rows });
    wfRunCount += rows.length;
  }
  log(`${wfRunCount} historical workflow runs`);

  // AI usage this month: $68 of the $100 demo budget (spec §89).
  const month = startOfMonthInTimeZone(timeZone).getTime();
  const span = Math.max(now - month, HOUR);
  const names = Object.keys(agents);
  await prisma.usageRecord.createMany({
    data: Array.from({ length: 34 }, (_, i) => ({
      orgId,
      kind: "AI_TOKENS" as const,
      agentId: agents[names[i % names.length]],
      model: DEMO_USAGE_MODEL,
      inputTokens: 40000,
      outputTokens: 6000,
      costUsd: 2,
      createdAt: new Date(month + (span * (i + 0.5)) / 34),
    })),
  });

  // A few feed entries in the spirit of spec §91.
  const feed: [string, string, string | null, number, string][] = [
    ["Sarah", "Sarah completed lead qualification.", "14 leads processed.", 2 * MIN, "/tasks"],
    ["Emma", "Emma answered a customer question.", "Refund policy used.", 5 * MIN, "/tasks"],
    ["Alex", "Alex completed keyword research.", "46 keywords analyzed.", 12 * MIN, "/tasks"],
    ["Maya", "Maya shared a competitor pricing brief.", "6 competitors compared.", 34 * MIN, "/tasks"],
    ["Liam", "Liam scheduled 5 LinkedIn posts.", null, 52 * MIN, "/tasks"],
    ["Olivia", "Olivia finished a blog draft.", "Sent for review.", 80 * MIN, "/tasks"],
  ];
  await prisma.activityLog.createMany({
    data: feed.map(([agent, summary, detail, ago, link]) => ({
      orgId,
      category: "TASK" as const,
      actorType: "AGENT" as const,
      actorAgentId: agents[agent],
      summary,
      detail,
      entityType: DEMO_ACTIVITY_ENTITY,
      link,
      createdAt: new Date(now - ago),
    })),
  });
}

async function main() {
  const started = new Date();
  registerAllJobHandlers();
  console.log("Seeding NBY Demo Company…");
  const { user, orgId, email } = await ensureDemoAdmin();
  const actor = userActor(orgId, user.id);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
  const firstTime = !org.isDemo;

  if (RESET && org.isDemo) {
    const removed = await removeDemoHistory(orgId);
    log(`removed previous demo history: ${JSON.stringify(removed)}`);
  }
  await prisma.organization.update({
    where: { id: orgId },
    data: { isDemo: true, industry: org.industry ?? "SaaS / Software", monthlyAiBudgetUsd: 100, description: org.description ?? "Demo workspace for exploring NBY AI Agents." },
  });

  const departments = await ensureDepartments(actor);
  await ensureIntegrations(actor);
  const kbId = await ensureKnowledge(actor);
  await settle(orgId); // index knowledge
  const agents = await ensureAgents(actor, departments, kbId);
  log(`${Object.keys(agents).length} employees ready`);
  const workflows = await ensureWorkflows(actor, departments, agents);

  if (firstTime || RESET) {
    // Real work that ends waiting for a human — only if nothing is already waiting,
    // so re-running with --reset doesn't pile up duplicate approvals.
    if ((await prisma.approval.count({ where: { orgId, status: "PENDING" } })) === 0) await createRealPendingWork(actor, agents, workflows);
    await createHistory(orgId, org.timezone, agents, workflows, user.id);

    // Employee states for the workforce view.
    for (const a of AGENTS) await prisma.agent.update({ where: { id: agents[a.name] }, data: { status: a.status, statusMessage: a.activity } });

    // One integration needs attention (spec §86): a simulated reauthorization request.
    await prisma.integrationConnection.updateMany({
      where: { orgId, integrationKey: "mock_calendar" },
      data: { status: "NEEDS_REAUTH", lastError: "Demo: reconnect Mock Calendar to restore access (simulated)." },
    });

    // Setup chatter ("X was published", "Y connected") would bury the operational feed.
    // The audit log keeps the authoritative record of those actions.
    await prisma.activityLog.deleteMany({
      where: { orgId, createdAt: { gte: started }, category: { in: ["AGENT", "WORKFLOW", "KNOWLEDGE", "INTEGRATION", "SYSTEM"] }, NOT: { entityType: DEMO_ACTIVITY_ENTITY } },
    });
  } else {
    log("demo history already exists — run `npm run db:seed -- --reset` to rebuild it");
  }

  const pending = await prisma.approval.groupBy({ by: ["kind"], where: { orgId, status: "PENDING" }, _count: true });
  log(`waiting for a human: ${pending.map((p) => `${p._count} ${p.kind.toLowerCase()}`).join(", ") || "nothing"}`);
  console.log(`Done. Sign in as ${email} (password in .env as DEMO_ADMIN_PASSWORD).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
