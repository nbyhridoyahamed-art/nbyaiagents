import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/tools/types";

/**
 * Simulated demo integrations. Every result carries `simulated: true` and the
 * data lives in the MockRecord table — nothing is sent to any external system.
 */

const SIM_NOTE = "Simulated integration — no external system was contacted.";

async function records(orgId: string, integrationKey: string, collection: string) {
  return prisma.mockRecord.findMany({ where: { orgId, integrationKey, collection }, orderBy: { createdAt: "desc" }, take: 500 });
}

async function insert(orgId: string, integrationKey: string, collection: string, data: Record<string, unknown>) {
  return prisma.mockRecord.create({ data: { orgId, integrationKey, collection, data: data as Prisma.InputJsonValue } });
}

function matches(data: unknown, q: string) {
  return JSON.stringify(data).toLowerCase().includes(q.toLowerCase());
}

const sim = (output: unknown, summary: string): ToolResult => ({ output, summary, simulated: true });

/** Read-only tools may omit `simulate`: previewing a read has no side effects. */
function def<S extends z.ZodType>(d: Omit<ToolDefinition<S>, "simulate"> & { simulate?: ToolDefinition<S>["simulate"] }): ToolDefinition {
  return { ...d, simulate: d.simulate ?? d.execute } as unknown as ToolDefinition;
}

// ── Mock CRM ────────────────────────────────────────────────────────────────

const contactFields = z.object({
  name: z.string().min(1).max(120).describe("Full name"),
  email: z.string().email().describe("Email address"),
  company: z.string().max(120).optional().describe("Company name"),
  source: z.string().max(60).optional().describe("Where the lead came from"),
  notes: z.string().max(2000).optional(),
});

export const MOCK_TOOLS: ToolDefinition[] = [
  def({
    key: "mock_crm.search_contacts",
    integrationKey: "mock_crm",
    name: "Search CRM contacts",
    description: "Search contacts and leads in the CRM by name, email or company.",
    inputSchema: z.object({ query: z.string().min(1).max(200).describe("Name, email or company to search for") }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: true,
    idempotent: true,
    async execute(input, ctx) {
      const rows = (await records(ctx.orgId, "mock_crm", "contacts")).filter((r) => matches(r.data, input.query));
      const results = rows.slice(0, 20).map((r) => ({ id: r.id, ...(r.data as object) }));
      return sim({ results, simulated: true, note: SIM_NOTE }, `Found ${results.length} contact${results.length === 1 ? "" : "s"}`);
    },
  }),
  def({
    key: "mock_crm.create_lead",
    integrationKey: "mock_crm",
    name: "Create CRM lead",
    description: "Create a new lead in the CRM. Skips creation if a contact with the same email already exists.",
    inputSchema: contactFields,
    riskLevel: "LOW",
    capabilities: ["data_modification"],
    simulated: true,
    idempotent: true,
    async execute(input, ctx) {
      const existing = (await records(ctx.orgId, "mock_crm", "contacts")).find((r) => (r.data as { email?: string }).email?.toLowerCase() === input.email.toLowerCase());
      if (existing) return sim({ id: existing.id, created: false, simulated: true, note: `${SIM_NOTE} A contact with this email already existed.` }, "Lead already existed");
      const row = await insert(ctx.orgId, "mock_crm", "contacts", { ...input, status: "new", createdByRun: ctx.runId });
      const { emitEvent } = await import("@/server/workflows/events");
      await emitEvent(ctx.orgId, "crm.lead.created", { lead: { id: row.id, ...input } }, { sourceWorkflowRunId: ctx.workflowRunId ?? null });
      return sim({ id: row.id, created: true, simulated: true, note: SIM_NOTE }, `Created lead ${input.name}`);
    },
    async simulate(input) {
      return sim({ wouldCreate: input, simulated: true }, `Would create lead ${input.name}`);
    },
  }),
  def({
    key: "mock_crm.update_contact",
    integrationKey: "mock_crm",
    name: "Update CRM contact",
    description: "Update fields (status, score, notes, stage) on an existing CRM contact.",
    inputSchema: z.object({
      id: z.string().min(1).describe("Contact ID, or the contact's email address"),
      status: z.string().max(40).optional(),
      score: z.number().min(0).max(100).optional(),
      stage: z.string().max(40).optional(),
      notes: z.string().max(2000).optional(),
    }),
    riskLevel: "MEDIUM",
    capabilities: ["data_modification"],
    simulated: true,
    idempotent: true,
    async execute(input, ctx) {
      const rows = await records(ctx.orgId, "mock_crm", "contacts");
      const row = rows.find((r) => r.id === input.id || (r.data as { email?: string }).email?.toLowerCase() === input.id.toLowerCase());
      if (!row) return sim({ updated: false, error: "Contact not found", simulated: true }, "Contact not found");
      const { id: _id, ...fields } = input;
      void _id;
      const data = { ...(row.data as object), ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)), updatedByRun: ctx.runId };
      await prisma.mockRecord.update({ where: { id: row.id }, data: { data: data as Prisma.InputJsonValue } });
      return sim({ id: row.id, updated: true, simulated: true, note: SIM_NOTE }, "Updated CRM contact");
    },
    async simulate(input) {
      return sim({ wouldUpdate: input, simulated: true }, "Would update CRM contact");
    },
  }),
  def({
    key: "mock_crm.delete_contact",
    integrationKey: "mock_crm",
    name: "Delete CRM contact",
    description: "Permanently delete a CRM contact.",
    inputSchema: z.object({ id: z.string().min(1) }),
    riskLevel: "CRITICAL",
    capabilities: ["data_deletion"],
    simulated: true,
    idempotent: false,
    async execute(input, ctx) {
      const deleted = await prisma.mockRecord.deleteMany({ where: { id: input.id, orgId: ctx.orgId, integrationKey: "mock_crm" } });
      return sim({ deleted: deleted.count > 0, simulated: true, note: SIM_NOTE }, deleted.count ? "Deleted contact" : "Contact not found");
    },
    async simulate(input) {
      return sim({ wouldDelete: input.id, simulated: true }, "Would delete contact");
    },
  }),

  // ── Mock Email ───────────────────────────────────────────────────────────
  def({
    key: "mock_email.read_inbox",
    integrationKey: "mock_email",
    name: "Read inbox",
    description: "Read recent messages from the inbox.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional(), query: z.string().max(200).optional() }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: true,
    idempotent: true,
    async execute(input, ctx) {
      const rows = (await records(ctx.orgId, "mock_email", "inbox")).filter((r) => !input.query || matches(r.data, input.query)).slice(0, input.limit ?? 10);
      return sim({ messages: rows.map((r) => ({ id: r.id, ...(r.data as object) })), simulated: true, note: SIM_NOTE }, `Read ${rows.length} message${rows.length === 1 ? "" : "s"}`);
    },
  }),
  def({
    key: "mock_email.draft_email",
    integrationKey: "mock_email",
    name: "Draft email",
    description: "Save an email draft. Drafts are not sent.",
    inputSchema: z.object({ to: z.string().min(3).max(500), subject: z.string().min(1).max(200), body: z.string().min(1).max(10000) }),
    riskLevel: "LOW",
    capabilities: [],
    simulated: true,
    idempotent: true,
    async execute(input, ctx) {
      const row = await insert(ctx.orgId, "mock_email", "drafts", { ...input, createdByRun: ctx.runId });
      return sim({ draftId: row.id, saved: true, simulated: true, note: SIM_NOTE }, `Drafted email to ${input.to}`);
    },
    async simulate(input) {
      return sim({ wouldDraft: input, simulated: true }, `Would draft email to ${input.to}`);
    },
  }),
  def({
    key: "mock_email.send_email",
    integrationKey: "mock_email",
    name: "Send email",
    description: "Send an email to one recipient.",
    inputSchema: z.object({ to: z.string().email(), subject: z.string().min(1).max(200), body: z.string().min(1).max(10000) }),
    riskLevel: "MEDIUM",
    capabilities: ["external_communication"],
    simulated: true,
    idempotent: false,
    async execute(input, ctx) {
      // Idempotency: one send per key, even if the step is retried.
      const dup = (await records(ctx.orgId, "mock_email", "outbox")).find((r) => (r.data as { idempotencyKey?: string }).idempotencyKey === ctx.idempotencyKey);
      if (dup) return sim({ messageId: dup.id, status: "already_recorded", simulated: true, note: SIM_NOTE }, "Already recorded (duplicate prevented)");
      const row = await insert(ctx.orgId, "mock_email", "outbox", { ...input, status: "recorded_not_delivered", idempotencyKey: ctx.idempotencyKey, createdByRun: ctx.runId });
      return sim(
        { messageId: row.id, status: "recorded_not_delivered", simulated: true, note: "Mock Email recorded this message in its outbox. No email was delivered." },
        `Email recorded in Mock Email outbox (not delivered) — to ${input.to}`,
      );
    },
    async simulate(input) {
      return sim({ wouldSend: input, simulated: true }, `Would send email to ${input.to}`);
    },
  }),
  def({
    key: "mock_email.send_bulk_email",
    integrationKey: "mock_email",
    name: "Send bulk email",
    description: "Send the same email to many recipients.",
    inputSchema: z.object({ recipients: z.array(z.string().email()).min(1).max(500), subject: z.string().min(1).max(200), body: z.string().min(1).max(10000) }),
    riskLevel: "HIGH",
    capabilities: ["external_communication", "bulk_outreach"],
    simulated: true,
    idempotent: false,
    async execute(input, ctx) {
      const row = await insert(ctx.orgId, "mock_email", "outbox", { ...input, bulk: true, status: "recorded_not_delivered", idempotencyKey: ctx.idempotencyKey, createdByRun: ctx.runId });
      return sim({ batchId: row.id, recipients: input.recipients.length, status: "recorded_not_delivered", simulated: true, note: SIM_NOTE }, `Bulk email to ${input.recipients.length} recorded (not delivered)`);
    },
    async simulate(input) {
      return sim({ wouldSendTo: input.recipients.length, simulated: true }, `Would send bulk email to ${input.recipients.length}`);
    },
  }),

  // ── Mock Calendar ────────────────────────────────────────────────────────
  def({
    key: "mock_calendar.list_events",
    integrationKey: "mock_calendar",
    name: "List calendar events",
    description: "List upcoming calendar events.",
    inputSchema: z.object({ days: z.number().int().min(1).max(60).optional() }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: true,
    idempotent: true,
    async execute(_input, ctx) {
      const rows = await records(ctx.orgId, "mock_calendar", "events");
      return sim({ events: rows.map((r) => ({ id: r.id, ...(r.data as object) })), simulated: true, note: SIM_NOTE }, `${rows.length} event${rows.length === 1 ? "" : "s"}`);
    },
  }),
  def({
    key: "mock_calendar.create_event",
    integrationKey: "mock_calendar",
    name: "Create calendar event",
    description: "Create a calendar event and invite attendees.",
    inputSchema: z.object({
      title: z.string().min(1).max(200),
      start: z.string().min(4).describe("ISO 8601 start time"),
      durationMinutes: z.number().int().min(5).max(480).optional(),
      attendees: z.array(z.string().email()).max(50).optional(),
    }),
    riskLevel: "MEDIUM",
    capabilities: ["calendar", "external_communication"],
    simulated: true,
    idempotent: false,
    async execute(input, ctx) {
      const row = await insert(ctx.orgId, "mock_calendar", "events", { ...input, createdByRun: ctx.runId });
      return sim({ eventId: row.id, created: true, simulated: true, note: SIM_NOTE }, `Created event "${input.title}" (simulated)`);
    },
    async simulate(input) {
      return sim({ wouldCreate: input, simulated: true }, `Would create event "${input.title}"`);
    },
  }),

  // ── Mock Search ──────────────────────────────────────────────────────────
  def({
    key: "mock_search.web_search",
    integrationKey: "mock_search",
    name: "Web search",
    description: "Search the web. (Simulated: returns clearly-labelled sample results.)",
    inputSchema: z.object({ query: z.string().min(1).max(300) }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: true,
    idempotent: true,
    async execute(input) {
      const results = [1, 2, 3].map((i) => ({
        title: `Sample result ${i} for "${input.query}"`,
        url: `https://example.com/sample-${i}`,
        snippet: "SAMPLE DATA — this is a simulated search result, not real web content.",
      }));
      return sim({ results, simulated: true, note: SIM_NOTE }, `3 sample results for "${input.query}"`);
    },
  }),
  def({
    key: "mock_search.company_profile",
    integrationKey: "mock_search",
    name: "Research company",
    description: "Look up a company profile by name or domain. (Simulated sample data.)",
    inputSchema: z.object({ company: z.string().min(1).max(200) }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: true,
    idempotent: true,
    async execute(input) {
      const seed = [...input.company].reduce((s, c) => s + c.charCodeAt(0), 0);
      const sizes = ["1-10", "11-50", "51-200", "201-1000", "1000+"];
      const industries = ["Software", "E-commerce", "Manufacturing", "Professional services", "Healthcare"];
      return sim(
        {
          company: input.company,
          industry: industries[seed % industries.length],
          employees: sizes[seed % sizes.length],
          summary: `SAMPLE DATA — simulated profile for ${input.company}. Connect a real research integration for live data.`,
          simulated: true,
        },
        `Researched ${input.company} (sample data)`,
      );
    },
  }),

  // ── Mock Sheets ──────────────────────────────────────────────────────────
  def({
    key: "mock_sheets.read_rows",
    integrationKey: "mock_sheets",
    name: "Read sheet rows",
    description: "Read rows from a spreadsheet by sheet name.",
    inputSchema: z.object({ sheet: z.string().min(1).max(100), limit: z.number().int().min(1).max(500).optional() }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: true,
    idempotent: true,
    async execute(input, ctx) {
      const rows = (await records(ctx.orgId, "mock_sheets", `sheet:${input.sheet.toLowerCase()}`)).slice(0, input.limit ?? 100).reverse();
      return sim({ sheet: input.sheet, rows: rows.map((r) => r.data), simulated: true, note: SIM_NOTE }, `Read ${rows.length} row${rows.length === 1 ? "" : "s"} from ${input.sheet}`);
    },
  }),
  def({
    key: "mock_sheets.append_row",
    integrationKey: "mock_sheets",
    name: "Append sheet row",
    description: "Append a row (object of column → value) to a spreadsheet.",
    inputSchema: z.object({ sheet: z.string().min(1).max(100), row: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])) }),
    riskLevel: "LOW",
    capabilities: ["data_modification"],
    simulated: true,
    idempotent: false,
    async execute(input, ctx) {
      await insert(ctx.orgId, "mock_sheets", `sheet:${input.sheet.toLowerCase()}`, input.row);
      return sim({ appended: true, simulated: true, note: SIM_NOTE }, `Appended a row to ${input.sheet}`);
    },
    async simulate(input) {
      return sim({ wouldAppend: input, simulated: true }, `Would append a row to ${input.sheet}`);
    },
  }),

  // ── Mock Store ───────────────────────────────────────────────────────────
  def({
    key: "mock_commerce.lookup_order",
    integrationKey: "mock_commerce",
    name: "Look up order",
    description: "Find an order by order number or customer email.",
    inputSchema: z.object({ query: z.string().min(1).max(200).describe("Order number or customer email") }),
    riskLevel: "LOW",
    capabilities: ["read_only", "sensitive_data"],
    simulated: true,
    idempotent: true,
    async execute(input, ctx) {
      const rows = (await records(ctx.orgId, "mock_commerce", "orders")).filter((r) => matches(r.data, input.query)).slice(0, 5);
      return sim({ orders: rows.map((r) => ({ id: r.id, ...(r.data as object) })), simulated: true, note: SIM_NOTE }, `Found ${rows.length} order${rows.length === 1 ? "" : "s"}`);
    },
  }),
  def({
    key: "mock_commerce.issue_refund",
    integrationKey: "mock_commerce",
    name: "Issue refund",
    description: "Refund an order (financial transaction).",
    inputSchema: z.object({ orderNumber: z.string().min(1).max(60), amount: z.number().positive().max(100000), reason: z.string().max(500).optional() }),
    riskLevel: "CRITICAL",
    capabilities: ["financial"],
    simulated: true,
    idempotent: false,
    async execute(input, ctx: ToolExecutionContext) {
      const row = await insert(ctx.orgId, "mock_commerce", "refunds", { ...input, status: "recorded_no_money_moved", idempotencyKey: ctx.idempotencyKey });
      return sim({ refundId: row.id, status: "recorded_no_money_moved", simulated: true, note: "Simulated refund recorded. No money moved." }, `Refund of ${input.amount} recorded (simulated — no money moved)`);
    },
    async simulate(input) {
      return sim({ wouldRefund: input, simulated: true }, `Would refund ${input.amount}`);
    },
  }),
];

/** Sample records created when a mock integration is connected (clearly demo data). */
export const MOCK_SEED: Record<string, { collection: string; data: Record<string, unknown> }[]> = {
  mock_crm: [
    { collection: "contacts", data: { name: "Jordan Lee", email: "jordan@northwind.example", company: "Northwind Traders", status: "customer", demo: true } },
    { collection: "contacts", data: { name: "Priya Shah", email: "priya@globex.example", company: "Globex", status: "lead", demo: true } },
  ],
  mock_email: [
    { collection: "inbox", data: { from: "priya@globex.example", subject: "Pricing for 50 seats?", body: "Hi, we're evaluating tools for our 50-person team. Could you share pricing?", demo: true } },
    { collection: "inbox", data: { from: "sam@initech.example", subject: "Where is my order #1042?", body: "My order #1042 hasn't arrived yet. Can you check?", demo: true } },
  ],
  mock_calendar: [{ collection: "events", data: { title: "Weekly marketing sync (demo)", start: "next Monday 10:00", demo: true } }],
  mock_commerce: [
    { collection: "orders", data: { orderNumber: "1042", customer: "sam@initech.example", status: "shipped", total: 89.5, carrier: "UPS", demo: true } },
    { collection: "orders", data: { orderNumber: "1043", customer: "lee@acme.example", status: "processing", total: 240, demo: true } },
  ],
  mock_sheets: [{ collection: "sheet:keywords", data: { keyword: "ai employees", volume: "sample", demo: true } }],
  mock_search: [],
};
