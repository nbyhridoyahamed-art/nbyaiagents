import { z } from "zod";
import type { ToolDefinition, ToolResult } from "@/lib/tools/types";
import { AppError } from "@/lib/errors";
import * as google from "@/lib/integrations/google/client";

const real = (output: unknown, summary: string): ToolResult => ({ output, summary, simulated: false });

function def<S extends z.ZodType>(d: Omit<ToolDefinition<S>, "simulate"> & { simulate?: ToolDefinition<S>["simulate"] }): ToolDefinition {
  return { ...d, simulate: d.simulate ?? d.execute } as unknown as ToolDefinition;
}

function requireToken(ctx: { secret?: string | null }): string {
  if (!ctx.secret) throw new AppError("NOT_CONFIGURED", "Google isn't connected for this workspace yet.");
  return ctx.secret;
}

export const GOOGLE_TOOLS: ToolDefinition[] = [
  // ── Gmail ───────────────────────────────────────────────────────────────
  def({
    key: "gmail.read_inbox",
    integrationKey: "gmail",
    name: "Read inbox",
    description: "Read recent Gmail messages, optionally filtered by a Gmail search query.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional(), query: z.string().max(200).optional() }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const messages = await google.gmailListMessages(requireToken(ctx), input.query, input.limit ?? 10);
      return real({ messages }, `Read ${messages.length} message${messages.length === 1 ? "" : "s"}`);
    },
  }),
  def({
    key: "gmail.draft_email",
    integrationKey: "gmail",
    name: "Draft email",
    description: "Save a Gmail draft. Drafts are not sent.",
    inputSchema: z.object({ to: z.string().min(3).max(500), subject: z.string().min(1).max(200), body: z.string().min(1).max(10000) }),
    riskLevel: "LOW",
    capabilities: [],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const draftId = await google.gmailDraft(requireToken(ctx), input.to, input.subject, input.body);
      return real({ draftId, saved: true }, `Drafted email to ${input.to}`);
    },
    async simulate(input) {
      return real({ wouldDraft: input }, `Would draft email to ${input.to}`);
    },
  }),
  def({
    key: "gmail.send_email",
    integrationKey: "gmail",
    name: "Send email",
    description: "Send a real email through Gmail to one recipient.",
    inputSchema: z.object({ to: z.string().email(), subject: z.string().min(1).max(200), body: z.string().min(1).max(10000) }),
    riskLevel: "MEDIUM",
    capabilities: ["external_communication"],
    simulated: false,
    idempotent: false,
    async execute(input, ctx) {
      const messageId = await google.gmailSend(requireToken(ctx), input.to, input.subject, input.body);
      return real({ messageId, status: "sent" }, `Sent email to ${input.to}`);
    },
    async simulate(input) {
      return real({ wouldSend: input }, `Would send email to ${input.to}`);
    },
  }),
  def({
    key: "gmail.send_bulk_email",
    integrationKey: "gmail",
    name: "Send bulk email",
    description: "Send the same email to many recipients through Gmail, one message per recipient.",
    inputSchema: z.object({ recipients: z.array(z.string().email()).min(1).max(500), subject: z.string().min(1).max(200), body: z.string().min(1).max(10000) }),
    riskLevel: "HIGH",
    capabilities: ["external_communication", "bulk_outreach"],
    simulated: false,
    idempotent: false,
    async execute(input, ctx) {
      const token = requireToken(ctx);
      const results = await Promise.allSettled(input.recipients.map((to) => google.gmailSend(token, to, input.subject, input.body)));
      const sent = results.filter((r) => r.status === "fulfilled").length;
      return real({ sent, failed: input.recipients.length - sent, total: input.recipients.length }, `Sent ${sent}/${input.recipients.length} emails`);
    },
    async simulate(input) {
      return real({ wouldSendTo: input.recipients.length }, `Would send to ${input.recipients.length} recipients`);
    },
  }),

  // ── Google Calendar ─────────────────────────────────────────────────────
  def({
    key: "google_calendar.list_events",
    integrationKey: "google_calendar",
    name: "List calendar events",
    description: "List upcoming events on the connected Google Calendar.",
    inputSchema: z.object({ days: z.number().int().min(1).max(60).optional() }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const events = await google.calendarListEvents(requireToken(ctx), input.days ?? 14);
      return real({ events }, `${events.length} event${events.length === 1 ? "" : "s"}`);
    },
  }),
  def({
    key: "google_calendar.create_event",
    integrationKey: "google_calendar",
    name: "Create calendar event",
    description: "Create a real Google Calendar event and email invitations to attendees.",
    inputSchema: z.object({
      title: z.string().min(1).max(200),
      start: z.string().min(4).describe("ISO 8601 start time"),
      durationMinutes: z.number().int().min(5).max(480).optional(),
      attendees: z.array(z.string().email()).max(50).optional(),
    }),
    riskLevel: "MEDIUM",
    capabilities: ["calendar", "external_communication"],
    simulated: false,
    idempotent: false,
    async execute(input, ctx) {
      const eventId = await google.calendarCreateEvent(requireToken(ctx), input.title, input.start, input.durationMinutes ?? 30, input.attendees ?? []);
      return real({ eventId, created: true }, `Created event "${input.title}"`);
    },
    async simulate(input) {
      return real({ wouldCreate: input }, `Would create event "${input.title}"`);
    },
  }),

  // ── Google Sheets ───────────────────────────────────────────────────────
  def({
    key: "google_sheets.read_rows",
    integrationKey: "google_sheets",
    name: "Read sheet rows",
    description: "Read rows from a tab of a Google Sheets spreadsheet.",
    inputSchema: z.object({
      spreadsheetId: z.string().min(1).max(120).describe("The spreadsheet's ID, from its URL"),
      sheet: z.string().min(1).max(100).describe("Tab name"),
      limit: z.number().int().min(1).max(500).optional(),
    }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const rows = await google.sheetsReadRows(requireToken(ctx), input.spreadsheetId, input.sheet, input.limit ?? 100);
      return real({ sheet: input.sheet, rows }, `Read ${rows.length} row${rows.length === 1 ? "" : "s"} from ${input.sheet}`);
    },
  }),
  def({
    key: "google_sheets.append_row",
    integrationKey: "google_sheets",
    name: "Append sheet row",
    description: "Append a row of values to a tab of a Google Sheets spreadsheet.",
    inputSchema: z.object({
      spreadsheetId: z.string().min(1).max(120).describe("The spreadsheet's ID, from its URL"),
      sheet: z.string().min(1).max(100).describe("Tab name"),
      row: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).min(1).max(200),
    }),
    riskLevel: "LOW",
    capabilities: ["data_modification"],
    simulated: false,
    idempotent: false,
    async execute(input, ctx) {
      await google.sheetsAppendRow(requireToken(ctx), input.spreadsheetId, input.sheet, input.row);
      return real({ appended: true }, `Appended a row to ${input.sheet}`);
    },
    async simulate(input) {
      return real({ wouldAppend: input }, `Would append a row to ${input.sheet}`);
    },
  }),
];
