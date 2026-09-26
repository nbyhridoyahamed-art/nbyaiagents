import { z } from "zod";
import type { JsonSchema } from "@/lib/ai/types";

/**
 * Serializable description of a structured output (spec §51). Stored in run and
 * workflow state, then compiled to JSON Schema (for the model) and Zod (to
 * validate what comes back).
 */
export const outputFieldSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/),
  type: z.enum(["string", "number", "integer", "boolean", "string_array"]),
  description: z.string().max(300).default(""),
  enum: z.array(z.string().max(100)).max(30).optional(),
  required: z.boolean().default(true),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const outputSpecSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/).default("result"),
  fields: z.array(outputFieldSchema).min(1).max(30),
});

export type OutputField = z.infer<typeof outputFieldSchema>;
export type OutputSpec = z.infer<typeof outputSpecSchema>;

export function outputJsonSchema(spec: OutputSpec): JsonSchema {
  return {
    type: "object",
    properties: Object.fromEntries(
      spec.fields.map((f) => {
        const base: Record<string, unknown> =
          f.type === "string_array" ? { type: "array", items: { type: "string" } } : { type: f.type };
        if (f.description) base.description = f.description;
        if (f.enum?.length && f.type === "string") base.enum = f.enum;
        if (f.min !== undefined && (f.type === "number" || f.type === "integer")) base.minimum = f.min;
        if (f.max !== undefined && (f.type === "number" || f.type === "integer")) base.maximum = f.max;
        return [f.name, base];
      }),
    ),
    required: spec.fields.filter((f) => f.required).map((f) => f.name),
    additionalProperties: false,
  };
}

export function outputZod(spec: OutputSpec) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of spec.fields) {
    let s: z.ZodType;
    if (f.type === "string") s = f.enum?.length ? z.enum(f.enum as [string, ...string[]]) : z.string();
    else if (f.type === "boolean") s = z.boolean();
    else if (f.type === "string_array") s = z.array(z.string());
    else {
      let n = f.type === "integer" ? z.number().int() : z.number();
      if (f.min !== undefined) n = n.min(f.min);
      if (f.max !== undefined) n = n.max(f.max);
      s = n;
    }
    shape[f.name] = f.required ? s : s.optional();
  }
  return z.object(shape);
}

/** Extracts the first JSON object from model text (tolerates code fences / prose). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object found in the response.");
  return JSON.parse(candidate.slice(start, end + 1));
}

export function validateOutput(spec: OutputSpec, text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = extractJson(text);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const result = outputZod(spec).safeParse(parsed);
  if (result.success) return { ok: true, value: result.data as Record<string, unknown> };
  return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
}
