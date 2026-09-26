import type { PermissionEffect, PolicyScope, RiskLevel } from "@/lib/generated/prisma/enums";
import { conditionsMatch, describeCondition, type ActionContext, type ApprovalCondition } from "@/lib/approvals/conditions";
import { CAPABILITIES, type Capability, type PolicyEnforcement } from "@/lib/policies/types";

/**
 * Runtime permission engine (spec §28). Pure and deterministic: every external
 * action an agent proposes is evaluated here *in code* before execution —
 * prompt instructions are never the only safeguard.
 *
 *   Tool → Organization policy → Department policy → Agent permission
 *        → Risk policy → Approval requirement → Execution
 *
 * The final outcome is the most restrictive result of all layers.
 */

export type Outcome = "ALLOW" | "REQUIRE_APPROVAL" | "DENY";

export interface CheckResult {
  layer: "system" | "tool" | "organization" | "department" | "agent" | "risk" | "approval_rule";
  outcome: Outcome;
  reason: string;
}

export interface PermissionDecision {
  outcome: Outcome;
  /** Human-readable reasons for any non-ALLOW outcome. */
  reasons: string[];
  checks: CheckResult[];
}

export interface EngineTool {
  key: string;
  name: string;
  riskLevel: RiskLevel;
  capabilities: string[];
  enabled: boolean;
  deleted: boolean;
}

export interface EnginePolicy {
  id: string;
  name: string;
  scope: PolicyScope;
  enforcement: PolicyEnforcement | null;
}

export interface EngineApprovalRule {
  id: string;
  name: string;
  conditions: ApprovalCondition[];
  effect: PermissionEffect;
}

export interface PermissionInput {
  tool: EngineTool;
  /** Live assignment (AgentTool). null = tool not assigned to this agent. */
  liveGrant: PermissionEffect | null;
  /** Grant recorded in the version snapshot being executed. undefined = not evaluated (draft run). null = absent from snapshot. */
  snapshotGrant?: PermissionEffect | null;
  agentPaused: boolean;
  /** Enabled policies that apply to this agent (org + its department + itself). */
  policies: EnginePolicy[];
  /** Enabled approval rules that apply to this agent. */
  approvalRules: EngineApprovalRule[];
  action: ActionContext;
}

const SEVERITY: Record<Outcome, number> = { ALLOW: 0, REQUIRE_APPROVAL: 1, DENY: 2 };
const RISK_ORDER: Record<RiskLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

function stricter(a: PermissionEffect, b: PermissionEffect): PermissionEffect {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

const LAYER_FOR_SCOPE: Record<PolicyScope, CheckResult["layer"]> = {
  ORGANIZATION: "organization",
  DEPARTMENT: "department",
  AGENT: "agent",
};

function capLabel(c: string) {
  return CAPABILITIES[c as Capability] ?? c;
}

export function evaluatePermission(input: PermissionInput): PermissionDecision {
  const checks: CheckResult[] = [];
  const { tool } = input;

  // System safety
  if (input.agentPaused) checks.push({ layer: "system", outcome: "DENY", reason: "This employee is paused." });

  // Tool
  if (tool.deleted || !tool.enabled) {
    checks.push({ layer: "tool", outcome: "DENY", reason: `${tool.name} is disabled or no longer exists.` });
  }

  // Organization / department / agent policies (machine-enforced rules only)
  for (const p of input.policies) {
    const e = p.enforcement;
    if (!e) continue;
    const layer = LAYER_FOR_SCOPE[p.scope];
    if (e.type === "deny_capability" && tool.capabilities.includes(e.capability)) {
      checks.push({ layer, outcome: "DENY", reason: `Blocked by policy "${p.name}" (${capLabel(e.capability)}).` });
    } else if (e.type === "require_approval_capability" && tool.capabilities.includes(e.capability)) {
      checks.push({ layer, outcome: "REQUIRE_APPROVAL", reason: `Policy "${p.name}" requires approval for ${capLabel(e.capability).toLowerCase()}.` });
    } else if (e.type === "deny_tool" && e.toolKey === tool.key) {
      checks.push({ layer, outcome: "DENY", reason: `Blocked by policy "${p.name}".` });
    } else if (e.type === "max_risk" && RISK_ORDER[tool.riskLevel] > RISK_ORDER[e.risk]) {
      checks.push({ layer, outcome: "DENY", reason: `Policy "${p.name}" blocks actions above ${e.risk.toLowerCase()} risk.` });
    }
  }

  // Agent permission — the stricter of the live grant and the executing version's grant.
  if (input.liveGrant === null) {
    checks.push({ layer: "agent", outcome: "DENY", reason: `This employee is not authorized to use ${tool.name}.` });
  } else {
    let grant = input.liveGrant;
    if (input.snapshotGrant === null) {
      checks.push({ layer: "agent", outcome: "DENY", reason: `${tool.name} is not part of the published version. Publish a new version to use it.` });
    } else if (input.snapshotGrant) {
      grant = stricter(grant, input.snapshotGrant);
    }
    if (grant === "DENY") checks.push({ layer: "agent", outcome: "DENY", reason: `${tool.name} is denied for this employee.` });
    else if (grant === "REQUIRE_APPROVAL") checks.push({ layer: "agent", outcome: "REQUIRE_APPROVAL", reason: `${tool.name} requires approval for this employee.` });
    else checks.push({ layer: "agent", outcome: "ALLOW", reason: `${tool.name} is allowed for this employee.` });
  }

  // Risk policy (system default): critical actions always need a human.
  if (tool.riskLevel === "CRITICAL") {
    checks.push({ layer: "risk", outcome: "REQUIRE_APPROVAL", reason: "Critical-risk actions always require human approval." });
  }

  // Approval rules (IF conditions THEN effect)
  for (const rule of input.approvalRules) {
    if (rule.effect === "ALLOW") continue;
    if (conditionsMatch(rule.conditions, input.action)) {
      const why = rule.conditions.map(describeCondition).join(" and ");
      checks.push({
        layer: "approval_rule",
        outcome: rule.effect === "DENY" ? "DENY" : "REQUIRE_APPROVAL",
        reason: `${rule.effect === "DENY" ? "Blocked" : "Approval required"} by rule "${rule.name}" (${why}).`,
      });
    }
  }

  const outcome = checks.reduce<Outcome>((acc, c) => (SEVERITY[c.outcome] > SEVERITY[acc] ? c.outcome : acc), "ALLOW");
  const reasons = checks.filter((c) => c.outcome !== "ALLOW" && c.outcome === outcome).map((c) => c.reason);
  return { outcome, reasons, checks };
}
