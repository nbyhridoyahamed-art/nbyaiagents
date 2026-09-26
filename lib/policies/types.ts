import { z } from "zod";

/**
 * Capabilities are coarse categories tools declare (e.g. a "send email" tool has
 * `external_communication`). Policies can deny or gate whole capabilities, which is
 * how company rules like "never make financial transactions" are enforced at runtime.
 */
export const CAPABILITIES = {
  external_communication: "External communication",
  bulk_outreach: "Bulk outreach",
  data_deletion: "Data deletion",
  data_modification: "Data modification",
  financial: "Financial activity",
  publishing: "Publishing content",
  sensitive_data: "Sensitive data access",
  calendar: "Calendar changes",
  read_only: "Read only",
} as const;

export type Capability = keyof typeof CAPABILITIES;
export const capabilityKeys = Object.keys(CAPABILITIES) as [Capability, ...Capability[]];

export const policyEnforcementSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("deny_capability"), capability: z.enum(capabilityKeys) }),
  z.object({ type: z.literal("require_approval_capability"), capability: z.enum(capabilityKeys) }),
  z.object({ type: z.literal("deny_tool"), toolKey: z.string().min(1) }),
  z.object({ type: z.literal("max_risk"), risk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]) }),
]);

export type PolicyEnforcement = z.infer<typeof policyEnforcementSchema>;

export function describeEnforcement(e: PolicyEnforcement | null | undefined): string {
  if (!e) return "Guidance — included in every agent's instructions";
  switch (e.type) {
    case "deny_capability":
      return `Runtime-enforced: blocks all "${CAPABILITIES[e.capability]}" actions`;
    case "require_approval_capability":
      return `Runtime-enforced: "${CAPABILITIES[e.capability]}" actions need human approval`;
    case "deny_tool":
      return `Runtime-enforced: blocks tool ${e.toolKey}`;
    case "max_risk":
      return `Runtime-enforced: blocks actions above ${e.risk.toLowerCase()} risk`;
  }
}
