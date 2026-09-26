import type { z } from "zod";
import type { ExecutionMode, RiskLevel } from "@/lib/generated/prisma/enums";
import type { Capability } from "@/lib/policies/types";

export interface ToolExecutionContext {
  orgId: string;
  agentId: string | null;
  runId: string | null;
  /** Set when the call happens inside a workflow run (used to prevent event feedback loops). */
  workflowRunId?: string | null;
  mode: ExecutionMode;
  /** Decrypted credential for the tool/connection. Server-only; never logged or sent to a model. */
  secret?: string | null;
  connectionConfig?: Record<string, unknown> | null;
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface ToolResult {
  /** JSON-serialisable output returned to the agent (treated as untrusted content). */
  output: unknown;
  /** Short operational summary for timelines, e.g. "Found 3 contacts". */
  summary: string;
  /** True when no real-world side effect happened (mock integration or simulation mode). */
  simulated: boolean;
}

/**
 * A registered tool (spec §23): purpose, schema, risk, permissions, handler and
 * error behaviour are declared in one place.
 */
export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  key: string;
  integrationKey: string;
  name: string;
  description: string;
  inputSchema: S;
  riskLevel: RiskLevel;
  capabilities: Capability[];
  /** Mock/demo tools never touch external systems. */
  simulated: boolean;
  /** Safe to retry automatically (reads, upserts keyed by idempotency). */
  idempotent: boolean;
  execute(input: z.infer<S>, ctx: ToolExecutionContext): Promise<ToolResult>;
  /** Preview used in simulation mode — must have no side effects. */
  simulate(input: z.infer<S>, ctx: ToolExecutionContext): Promise<ToolResult>;
}
