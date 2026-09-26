import type { WorkflowGraph } from "@/lib/workflows/types";

/**
 * Workflow templates (spec §60). A template is a graph builder: installing it asks
 * which employee fills each role, then creates an ordinary draft workflow the user
 * can customize, simulate and publish. Nothing is published automatically.
 */

export interface WorkflowTemplateRole {
  key: string;
  label: string;
  description: string;
  /** Employee template to hire if nobody suitable exists yet. */
  agentTemplate: string;
}

export interface WorkflowTemplate {
  key: string;
  version: number;
  name: string;
  category: "Sales" | "Support" | "Marketing";
  summary: string;
  /** Human-readable stages, shown as "A → B → C". */
  stages: string[];
  roles: WorkflowTemplateRole[];
  integrations: string[];
  /** Tools whose approval requirement this template relies on for human oversight. */
  expectsApproval: { role: string; toolKey: string; why: string }[];
  sampleInput: Record<string, unknown>;
  build(roles: Record<string, string>): WorkflowGraph;
}

const at = (x: number, y = 140) => ({ x, y });

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: "lead-generation",
    version: 1,
    name: "Lead Generation",
    category: "Sales",
    summary: "Research a new lead, qualify it against your Sales SOP, log it in the CRM and send personalised outreach — after a human approves the email.",
    stages: ["Find Leads", "Research", "Qualify", "CRM", "Draft Outreach", "Approval", "Send"],
    roles: [{ key: "sales", label: "Sales employee", description: "Qualifies the lead and writes the outreach.", agentTemplate: "sales-representative" }],
    integrations: ["mock_search", "mock_crm", "mock_email"],
    expectsApproval: [{ role: "sales", toolKey: "mock_email.send_email", why: "Every outreach email should be approved before it's sent." }],
    sampleInput: { lead: { name: "Dana Ortiz", email: "dana@initech.example", company: "Initech" } },
    build: ({ sales }) => ({
      nodes: [
        { key: "trigger", type: "trigger.manual", label: "New lead", config: { inputFields: ["lead.name", "lead.email", "lead.company"] }, position: at(0) },
        { key: "research", type: "tool.call", label: "Research company", config: { toolKey: "mock_search.company_profile", input: { company: "{{trigger.lead.company}}" }, agentId: sales }, position: at(280) },
        {
          key: "qualify",
          type: "agent.run",
          label: "Qualify lead",
          config: {
            agentId: sales,
            instructions: "Qualify {{trigger.lead.name}} from {{trigger.lead.company}} using the Sales SOP. Company research: {{nodes.research}}. Give a score from 0 to 100 and a one-line reason.",
          },
          position: at(560),
        },
        {
          key: "crm",
          type: "tool.call",
          label: "Log in CRM",
          config: { toolKey: "mock_crm.create_lead", input: { name: "{{trigger.lead.name}}", email: "{{trigger.lead.email}}", company: "{{trigger.lead.company}}", source: "Lead Generation workflow", notes: "{{nodes.qualify.text}}" }, agentId: sales },
          position: at(840),
        },
        {
          key: "draft",
          type: "ai.generate",
          label: "Draft outreach",
          config: { prompt: "Write a short, friendly first outreach email to {{trigger.lead.name}} at {{trigger.lead.company}}. Context: {{nodes.qualify.text}}. No pricing promises. Sign off as the sales team." },
          position: at(1120),
        },
        {
          key: "send",
          type: "tool.call",
          label: "Send email (needs approval)",
          config: { toolKey: "mock_email.send_email", input: { to: "{{trigger.lead.email}}", subject: "A quick idea for {{trigger.lead.company}}", body: "{{nodes.draft.text}}" }, agentId: sales },
          position: at(1400),
        },
      ],
      edges: [
        { key: "e1", source: "trigger", target: "research" },
        { key: "e2", source: "research", target: "qualify" },
        { key: "e3", source: "qualify", target: "crm" },
        { key: "e4", source: "crm", target: "draft" },
        { key: "e5", source: "draft", target: "send" },
      ],
    }),
  },
  {
    key: "customer-support",
    version: 1,
    name: "Customer Support",
    category: "Support",
    summary: "Understand an incoming message, answer it from company knowledge, check the answer and either reply or hand it to a human.",
    stages: ["Incoming Message", "Understand", "Search Knowledge", "Generate Response", "Validate", "Respond / Escalate"],
    roles: [{ key: "support", label: "Support employee", description: "Answers from company knowledge and replies to the customer.", agentTemplate: "customer-support-agent" }],
    integrations: ["mock_email"],
    expectsApproval: [{ role: "support", toolKey: "mock_email.send_email", why: "Replies to customers go out only after approval until you trust the answers." }],
    sampleInput: { message: "Hi, how long do refunds take?", customer_email: "sam@globex.example" },
    build: ({ support }) => ({
      nodes: [
        { key: "trigger", type: "trigger.manual", label: "Incoming message", config: { inputFields: ["message", "customer_email"] }, position: at(0, 160) },
        { key: "understand", type: "ai.classify", label: "Understand", config: { input: "{{trigger.message}}", categories: ["question", "refund", "complaint", "other"] }, position: at(280, 160) },
        {
          key: "answer",
          type: "agent.run",
          label: "Search knowledge & answer",
          config: { agentId: support, instructions: "A customer wrote ({{nodes.understand.category}}): {{trigger.message}}\n\nAnswer using company knowledge only and cite it. If the knowledge doesn't cover it, say so." },
          position: at(560, 160),
        },
        {
          key: "validate",
          type: "ai.decision",
          label: "Validate answer",
          config: { question: "Is this reply fully supported by company policy and safe to send as-is?\n\nReply: {{nodes.answer.text}}", options: ["send", "escalate"] },
          position: at(840, 160),
        },
        { key: "check", type: "logic.if", label: "Ready to send?", config: { condition: { mode: "all", conditions: [{ left: "{{nodes.validate.decision}}", op: "eq", right: "send" }] } }, position: at(1120, 160) },
        {
          key: "respond",
          type: "tool.call",
          label: "Respond",
          config: { toolKey: "mock_email.send_email", input: { to: "{{trigger.customer_email}}", subject: "Re: your message", body: "{{nodes.answer.text}}" }, agentId: support },
          position: at(1400, 60),
        },
        { key: "escalate", type: "human.review", label: "Escalate to a human", config: { title: "Customer reply needs a human", content: "Customer: {{trigger.message}}\n\nDraft reply: {{nodes.answer.text}}" }, position: at(1400, 260) },
      ],
      edges: [
        { key: "e1", source: "trigger", target: "understand" },
        { key: "e2", source: "understand", target: "answer" },
        { key: "e3", source: "answer", target: "validate" },
        { key: "e4", source: "validate", target: "check" },
        { key: "e5", source: "check", target: "respond", sourceHandle: "true" },
        { key: "e6", source: "check", target: "escalate", sourceHandle: "false" },
      ],
    }),
  },
  {
    key: "content-marketing",
    version: 1,
    name: "Content Marketing",
    category: "Marketing",
    summary: "Turn a topic into a researched, SEO-checked article that a human reviews before it goes on the content calendar.",
    stages: ["Topic", "Research", "Outline", "Write", "SEO Check", "Human Review", "Publish"],
    roles: [
      { key: "researcher", label: "Researcher", description: "Gathers facts and sources on the topic.", agentTemplate: "research-assistant" },
      { key: "writer", label: "Writer", description: "Outlines and writes the article.", agentTemplate: "content-writer" },
      { key: "seo", label: "SEO reviewer", description: "Checks the draft against your SEO guidelines.", agentTemplate: "seo-specialist" },
    ],
    integrations: ["mock_search", "mock_sheets"],
    expectsApproval: [],
    sampleInput: { topic: "How small teams can onboard AI employees" },
    build: ({ researcher, writer, seo }) => ({
      nodes: [
        { key: "trigger", type: "trigger.manual", label: "Topic", config: { inputFields: ["topic"] }, position: at(0) },
        { key: "research", type: "ai.research", label: "Research", config: { agentId: researcher, topic: "{{trigger.topic}}" }, position: at(280) },
        { key: "outline", type: "agent.run", label: "Outline", config: { agentId: writer, instructions: "Outline an article on {{trigger.topic}} using this research:\n{{nodes.research.text}}" }, position: at(560) },
        { key: "write", type: "agent.run", label: "Write", config: { agentId: writer, instructions: "Write the article from this outline, following the brand voice guide:\n{{nodes.outline.text}}" }, position: at(840) },
        { key: "seo_check", type: "agent.run", label: "SEO check", config: { agentId: seo, instructions: "Check this draft against the SEO guidelines and return the improved version:\n{{nodes.write.text}}" }, position: at(1120) },
        { key: "review", type: "human.review", label: "Human review", config: { title: "Article ready for review: {{trigger.topic}}", content: "{{nodes.seo_check.text}}" }, position: at(1400) },
        {
          key: "publish",
          type: "tool.call",
          label: "Publish to content calendar",
          config: { toolKey: "mock_sheets.append_row", input: { sheet: "Content calendar", row: { topic: "{{trigger.topic}}", status: "approved", approved_at: "{{now}}" } } },
          position: at(1680),
        },
      ],
      edges: [
        { key: "e1", source: "trigger", target: "research" },
        { key: "e2", source: "research", target: "outline" },
        { key: "e3", source: "outline", target: "write" },
        { key: "e4", source: "write", target: "seo_check" },
        { key: "e5", source: "seo_check", target: "review" },
        { key: "e6", source: "review", target: "publish", sourceHandle: "approved" },
      ],
    }),
  },
];

export function getWorkflowTemplate(key: string) {
  return WORKFLOW_TEMPLATES.find((t) => t.key === key);
}
