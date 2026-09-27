import { z } from "zod";
import type { JsonSchema } from "@/lib/ai/types";
import type { ToolDefinition } from "@/lib/tools/types";
import { MOCK_TOOLS } from "@/lib/integrations/mock/tools";
import { GOOGLE_TOOLS } from "@/lib/integrations/google/tools";
import { HUBSPOT_TOOLS } from "@/lib/integrations/hubspot/tools";
import { SHOPIFY_TOOLS } from "@/lib/integrations/shopify/tools";
import { SEARCH_TOOLS } from "@/lib/integrations/search/tools";

/**
 * Central tool registry (spec §23). Built-in integration tools are registered
 * here at startup; custom REST tools are defined per organization in the database
 * and executed by the HTTP tool runner. Nothing executes a tool except the
 * server-side executor (server/tools/executor.ts).
 */
const REGISTRY = new Map<string, ToolDefinition>();

export function registerTool(def: ToolDefinition) {
  if (REGISTRY.has(def.key)) throw new Error(`Tool already registered: ${def.key}`);
  REGISTRY.set(def.key, def);
}

for (const def of [...MOCK_TOOLS, ...GOOGLE_TOOLS, ...HUBSPOT_TOOLS, ...SHOPIFY_TOOLS, ...SEARCH_TOOLS]) registerTool(def);

export function getToolDefinition(key: string): ToolDefinition | undefined {
  return REGISTRY.get(key);
}

export function toolsForIntegration(integrationKey: string): ToolDefinition[] {
  return [...REGISTRY.values()].filter((t) => t.integrationKey === integrationKey);
}

export function zodToJsonSchema(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as JsonSchema;
  delete json.$schema;
  return json;
}
