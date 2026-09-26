import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getToolDefinition } from "@/lib/tools/registry";
import { httpConfigSchema, httpInputZod } from "@/lib/tools/http-config";

/** Validates an (edited) tool input against the tool's schema; throws a readable AppError. */
export async function validateToolInput(orgId: string, toolKey: string, input: unknown): Promise<Record<string, unknown>> {
  const tool = await prisma.tool.findFirst({ where: { orgId, key: toolKey } });
  if (!tool) throw new AppError("NOT_FOUND", "Tool not found.");
  const schema =
    tool.kind === "BUILTIN" ? getToolDefinition(tool.key)?.inputSchema : tool.kind === "CUSTOM_HTTP" ? httpInputZod(httpConfigSchema.parse(tool.httpConfig).parameters) : undefined;
  if (!schema) throw new AppError("NOT_CONFIGURED", "This tool can't be validated.");
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError("VALIDATION", `The edited action is invalid: ${result.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`);
  }
  return result.data as Record<string, unknown>;
}
