import { z } from "zod";
import type { JsonSchema } from "@/lib/ai/types";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export const httpParameterSchema = z.object({
  name: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/, "Use letters, numbers and underscores.")
    .describe("Parameter name"),
  in: z.enum(["path", "query", "body", "header"]),
  type: z.enum(["string", "number", "integer", "boolean"]),
  required: z.boolean().default(false),
  description: z.string().max(300).default(""),
  enum: z.array(z.string().max(100)).max(50).optional(),
});

export const httpAuthSchema = z.object({
  type: z.enum(["none", "bearer", "api_key", "basic", "oauth2"]),
  credentialId: z.string().max(40).nullable().optional(),
  /** api_key: where to put the key */
  location: z.enum(["header", "query"]).optional(),
  /** api_key: header or query parameter name */
  keyName: z.string().max(100).optional(),
});

export const httpConfigSchema = z
  .object({
    method: z.enum(HTTP_METHODS),
    url: z.string().min(8).max(2000),
    parameters: z.array(httpParameterSchema).max(40).default([]),
    headers: z
      .array(z.object({ name: z.string().regex(/^[A-Za-z0-9-]{1,100}$/, "Invalid header name."), value: z.string().max(1000) }))
      .max(20)
      .default([]),
    bodyType: z.enum(["json", "form"]).default("json"),
    auth: httpAuthSchema.default({ type: "none" }),
    responsePath: z.string().max(200).optional(),
    timeoutMs: z.number().int().min(1000).max(60000).default(20000),
  })
  .superRefine((cfg, ctx) => {
    const pathParams = [...cfg.url.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]);
    for (const p of pathParams) {
      const def = cfg.parameters.find((x) => x.name === p);
      if (!def) ctx.addIssue({ code: "custom", path: ["parameters"], message: `URL uses {${p}} but no parameter named "${p}" is defined.` });
      else if (def.in !== "path") ctx.addIssue({ code: "custom", path: ["parameters"], message: `Parameter "${p}" appears in the URL, so it must be a path parameter.` });
    }
    const names = cfg.parameters.map((p) => p.name);
    if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", path: ["parameters"], message: "Parameter names must be unique." });
    if (cfg.auth.type !== "none" && !cfg.auth.credentialId) ctx.addIssue({ code: "custom", path: ["auth", "credentialId"], message: "Choose a credential for authentication." });
    if (cfg.auth.type === "api_key" && !cfg.auth.keyName) ctx.addIssue({ code: "custom", path: ["auth", "keyName"], message: "Name the header or query parameter for the API key." });
    for (const h of cfg.headers) {
      if (/^(authorization|cookie|x-api-key)$/i.test(h.name)) {
        ctx.addIssue({ code: "custom", path: ["headers"], message: `Put ${h.name} in Authentication so it's stored encrypted, not as a plain header.` });
      }
    }
  });

export type HttpConfig = z.output<typeof httpConfigSchema>;
export type HttpParameter = z.output<typeof httpParameterSchema>;

/** Machine-readable input schema for the model (spec §25). */
export function httpInputJsonSchema(params: HttpParameter[]): JsonSchema {
  return {
    type: "object",
    properties: Object.fromEntries(
      params.map((p) => [p.name, { type: p.type, ...(p.description ? { description: p.description } : {}), ...(p.enum?.length ? { enum: p.enum } : {}) }]),
    ),
    required: params.filter((p) => p.required).map((p) => p.name),
    additionalProperties: false,
  };
}

/** Zod validator equivalent of the JSON schema — used before every execution. */
export function httpInputZod(params: HttpParameter[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const p of params) {
    let s: z.ZodType =
      p.enum?.length && p.type === "string"
        ? z.enum(p.enum as [string, ...string[]])
        : p.type === "string"
          ? z.string().max(5000)
          : p.type === "boolean"
            ? z.boolean()
            : p.type === "integer"
              ? z.number().int()
              : z.number();
    if (!p.required) s = s.optional();
    shape[p.name] = s;
  }
  return z.object(shape).strict();
}

export interface BuiltRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * Builds the outgoing request. `secret` is injected here, server-side only — it
 * never appears in the model context, logs or stored run data.
 */
export function buildHttpRequest(cfg: HttpConfig, input: Record<string, unknown>, secret?: string | null): BuiltRequest {
  let url = cfg.url.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, name: string) => encodeURIComponent(String(input[name] ?? "")));
  const u = new URL(url);
  const headers: Record<string, string> = {};
  const body: Record<string, unknown> = {};
  for (const p of cfg.parameters) {
    const v = input[p.name];
    if (v === undefined || v === null) continue;
    if (p.in === "query") u.searchParams.set(p.name, String(v));
    else if (p.in === "header") headers[p.name] = String(v).replace(/[\r\n]/g, " ");
    else if (p.in === "body") body[p.name] = v;
  }
  for (const h of cfg.headers) headers[h.name] = h.value.replace(/[\r\n]/g, " ");

  if (cfg.auth.type !== "none" && secret) {
    if (cfg.auth.type === "bearer" || cfg.auth.type === "oauth2") headers["Authorization"] = `Bearer ${secret}`;
    else if (cfg.auth.type === "basic") headers["Authorization"] = `Basic ${Buffer.from(secret).toString("base64")}`;
    else if (cfg.auth.type === "api_key") {
      if (cfg.auth.location === "query") u.searchParams.set(cfg.auth.keyName ?? "api_key", secret);
      else headers[cfg.auth.keyName ?? "X-API-Key"] = secret;
    }
  }
  url = u.toString();
  let payload: string | undefined;
  if (cfg.method !== "GET" && cfg.method !== "DELETE" && Object.keys(body).length) {
    if (cfg.bodyType === "form") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      payload = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])).toString();
    } else {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
  }
  headers["Accept"] ??= "application/json";
  return { method: cfg.method, url, headers, body: payload };
}

export function pickPath(value: unknown, path?: string): unknown {
  if (!path) return value;
  return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), value);
}

/** Risk the platform suggests for a custom tool by HTTP method. Owners can raise it. */
export function suggestedRisk(method: HttpConfig["method"]) {
  return method === "GET" ? "LOW" : method === "DELETE" ? "HIGH" : "MEDIUM";
}
