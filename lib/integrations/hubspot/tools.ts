import { z } from "zod";
import type { ToolDefinition, ToolResult } from "@/lib/tools/types";
import { AppError } from "@/lib/errors";
import * as hubspot from "@/lib/integrations/hubspot/client";

const real = (output: unknown, summary: string): ToolResult => ({ output, summary, simulated: false });

function def<S extends z.ZodType>(d: Omit<ToolDefinition<S>, "simulate"> & { simulate?: ToolDefinition<S>["simulate"] }): ToolDefinition {
  return { ...d, simulate: d.simulate ?? d.execute } as unknown as ToolDefinition;
}

function requireToken(ctx: { secret?: string | null }): string {
  if (!ctx.secret) throw new AppError("NOT_CONFIGURED", "HubSpot isn't connected for this workspace yet.");
  return ctx.secret;
}

function splitName(name: string): { firstname: string; lastname: string } {
  const [first, ...rest] = name.trim().split(/\s+/);
  return { firstname: first ?? name, lastname: rest.join(" ") };
}

export const HUBSPOT_TOOLS: ToolDefinition[] = [
  def({
    key: "hubspot.search_contacts",
    integrationKey: "hubspot",
    name: "Search CRM contacts",
    description: "Search HubSpot contacts by name, email or company.",
    inputSchema: z.object({ query: z.string().min(1).max(200).describe("Name, email or company to search for") }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const results = await hubspot.searchContacts(requireToken(ctx), input.query, 20);
      return real({ results }, `Found ${results.length} contact${results.length === 1 ? "" : "s"}`);
    },
  }),
  def({
    key: "hubspot.create_lead",
    integrationKey: "hubspot",
    name: "Create CRM lead",
    description: "Create a new contact in HubSpot.",
    inputSchema: z.object({
      name: z.string().min(1).max(120).describe("Full name"),
      email: z.string().email(),
      company: z.string().max(120).optional(),
      source: z.string().max(60).optional().describe("Recorded as the lead source note, not synced to a HubSpot property"),
      notes: z.string().max(2000).optional(),
    }),
    riskLevel: "LOW",
    capabilities: ["data_modification"],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const { firstname, lastname } = splitName(input.name);
      const contact = await hubspot.createContact(requireToken(ctx), { email: input.email, firstname, lastname, ...(input.company ? { company: input.company } : {}) });
      return real({ id: contact.id, created: true }, `Created lead ${input.name}`);
    },
    async simulate(input) {
      return real({ wouldCreate: input }, `Would create lead ${input.name}`);
    },
  }),
  def({
    key: "hubspot.update_contact",
    integrationKey: "hubspot",
    name: "Update CRM contact",
    description: "Update HubSpot properties on an existing contact (property names must exist in the portal, e.g. lifecyclestage, company).",
    inputSchema: z.object({
      id: z.string().min(1).describe("Contact ID, or the contact's email address"),
      properties: z.record(z.string(), z.union([z.string(), z.number()])).refine((v) => Object.keys(v).length > 0, "Provide at least one property to update."),
    }),
    riskLevel: "MEDIUM",
    capabilities: ["data_modification"],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const contact = await hubspot.updateContact(requireToken(ctx), input.id, input.properties);
      return real({ id: contact.id, updated: true }, "Updated CRM contact");
    },
    async simulate(input) {
      return real({ wouldUpdate: input }, "Would update CRM contact");
    },
  }),
  def({
    key: "hubspot.delete_contact",
    integrationKey: "hubspot",
    name: "Delete CRM contact",
    description: "Archive (delete) a HubSpot contact.",
    inputSchema: z.object({ id: z.string().min(1).describe("Contact ID, or the contact's email address") }),
    riskLevel: "CRITICAL",
    capabilities: ["data_deletion"],
    simulated: false,
    idempotent: false,
    async execute(input, ctx) {
      const deleted = await hubspot.archiveContact(requireToken(ctx), input.id);
      return real({ deleted }, deleted ? "Deleted contact" : "Contact not found");
    },
    async simulate(input) {
      return real({ wouldDelete: input.id }, "Would delete contact");
    },
  }),
];
