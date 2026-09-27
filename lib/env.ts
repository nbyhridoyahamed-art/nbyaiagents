import { z } from "zod";

/**
 * Validated server environment. Parsed lazily so importing modules never crashes
 * at build time; the first access throws a readable error if config is invalid.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().optional().default(""),
  ENCRYPTION_KEY: z
    .string()
    .min(1, "ENCRYPTION_KEY is required (32 bytes, base64)")
    .refine((v) => Buffer.from(v, "base64").length === 32, "ENCRYPTION_KEY must decode to 32 bytes"),
  SIGNING_SECRET: z.string().min(16, "SIGNING_SECRET must be at least 16 characters"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  OPENAI_API_KEY: z.string().optional().default(""),
  GOOGLE_API_KEY: z.string().optional().default(""),
  OPENAI_COMPATIBLE_BASE_URL: z.string().optional().default(""),
  OPENAI_COMPATIBLE_API_KEY: z.string().optional().default(""),
  OPENAI_COMPATIBLE_MODEL: z.string().optional().default(""),
  /** Optional platform-wide keys for OpenAI-style providers (organizations can add their own instead). */
  OPENROUTER_API_KEY: z.string().optional().default(""),
  OPENROUTER_MODEL: z.string().optional().default(""),
  GROQ_API_KEY: z.string().optional().default(""),
  GROQ_MODEL: z.string().optional().default(""),
  CEREBRAS_API_KEY: z.string().optional().default(""),
  CEREBRAS_MODEL: z.string().optional().default(""),
  MISTRAL_API_KEY: z.string().optional().default(""),
  MISTRAL_MODEL: z.string().optional().default(""),
  OLLAMA_BASE_URL: z.string().optional().default(""),
  OLLAMA_API_KEY: z.string().optional().default(""),
  OLLAMA_MODEL: z.string().optional().default(""),
  /** "file" writes messages to EMAIL_FILE_DIR — local development and end-to-end tests only. */
  EMAIL_PROVIDER: z.enum(["console", "resend", "file"]).default("console"),
  EMAIL_FILE_DIR: z.string().default(".data/mailbox"),
  EMAIL_FROM: z.string().default("Virtual Desks Online <no-reply@localhost>"),
  RESEND_API_KEY: z.string().optional().default(""),
  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".data/storage"),
  ALLOW_PRIVATE_NETWORK_TOOLS: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional().default(""),
  HUBSPOT_OAUTH_CLIENT_ID: z.string().optional().default(""),
  HUBSPOT_OAUTH_CLIENT_SECRET: z.string().optional().default(""),
  /** Platform-wide key for the real Web Search tool (Tavily). No per-org credential. */
  TAVILY_API_KEY: z.string().optional().default(""),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => env().NODE_ENV === "production";
