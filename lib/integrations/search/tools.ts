import { z } from "zod";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/tools/types";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import * as tavily from "@/lib/integrations/search/client";

const real = (output: unknown, summary: string): ToolResult => ({ output, summary, simulated: false });

function def<S extends z.ZodType>(d: Omit<ToolDefinition<S>, "simulate"> & { simulate?: ToolDefinition<S>["simulate"] }): ToolDefinition {
  return { ...d, simulate: d.simulate ?? d.execute } as unknown as ToolDefinition;
}

/** The company's own Tavily key (saved on the Integrations page) wins; otherwise the platform-wide TAVILY_API_KEY. */
export function resolveApiKey(ctx: Pick<ToolExecutionContext, "secret">): string {
  const key = ctx.secret || env().TAVILY_API_KEY;
  if (!key) throw new AppError("NOT_CONFIGURED", "Web Search isn't connected yet. Add a Tavily API key on the Integrations page.");
  return key;
}

export const SEARCH_TOOLS: ToolDefinition[] = [
  def({
    key: "web_search.search",
    integrationKey: "web_search",
    name: "Web search",
    description: "Search the live web.",
    inputSchema: z.object({ query: z.string().min(1).max(300) }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const results = await tavily.webSearch(resolveApiKey(ctx), input.query);
      return real({ results }, `${results.length} result${results.length === 1 ? "" : "s"} for "${input.query}"`);
    },
  }),
  def({
    key: "web_search.company_profile",
    integrationKey: "web_search",
    name: "Research company",
    description: "Look up a company profile by name or domain from live web sources.",
    inputSchema: z.object({ company: z.string().min(1).max(200) }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const profile = await tavily.companyProfile(resolveApiKey(ctx), input.company);
      return real({ company: input.company, ...profile }, `Researched ${input.company}`);
    },
  }),
];
