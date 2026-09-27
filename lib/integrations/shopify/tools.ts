import { z } from "zod";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/tools/types";
import { AppError } from "@/lib/errors";
import * as shopify from "@/lib/integrations/shopify/client";

const real = (output: unknown, summary: string): ToolResult => ({ output, summary, simulated: false });

function def<S extends z.ZodType>(d: Omit<ToolDefinition<S>, "simulate"> & { simulate?: ToolDefinition<S>["simulate"] }): ToolDefinition {
  return { ...d, simulate: d.simulate ?? d.execute } as unknown as ToolDefinition;
}

function creds(ctx: ToolExecutionContext): { shop: string; token: string } {
  const shop = (ctx.connectionConfig as { shop?: string } | null)?.shop;
  if (!shop || !ctx.secret) throw new AppError("NOT_CONFIGURED", "Shopify isn't connected for this workspace yet.");
  return { shop, token: ctx.secret };
}

export const SHOPIFY_TOOLS: ToolDefinition[] = [
  def({
    key: "shopify.lookup_order",
    integrationKey: "shopify",
    name: "Look up order",
    description: "Find a Shopify order by order number (e.g. #1042) or customer email.",
    inputSchema: z.object({ query: z.string().min(1).max(200).describe("Order number or customer email") }),
    riskLevel: "LOW",
    capabilities: ["read_only", "sensitive_data"],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const { shop, token } = creds(ctx);
      const orders = await shopify.findOrders(shop, token, input.query, 5);
      return real({ orders }, `Found ${orders.length} order${orders.length === 1 ? "" : "s"}`);
    },
  }),
  def({
    key: "shopify.issue_refund",
    integrationKey: "shopify",
    name: "Issue refund",
    description: "Refund a Shopify order against its original payment transaction. Moves real money.",
    inputSchema: z.object({ orderNumber: z.string().min(1).max(60), amount: z.number().positive().max(100000), reason: z.string().max(500).optional() }),
    riskLevel: "CRITICAL",
    capabilities: ["financial"],
    simulated: false,
    idempotent: false,
    async execute(input, ctx) {
      const { shop, token } = creds(ctx);
      const { refundId, orderId } = await shopify.issueRefund(shop, token, input.orderNumber, input.amount, input.reason);
      return real({ refundId, orderId, status: "refunded" }, `Refunded ${input.amount} on order ${input.orderNumber}`);
    },
    async simulate(input) {
      return real({ wouldRefund: input }, `Would refund ${input.amount} on order ${input.orderNumber}`);
    },
  }),
];
