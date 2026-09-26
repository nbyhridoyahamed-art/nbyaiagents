import { describe, expect, it } from "vitest";
import { evaluatePermission, type PermissionInput } from "@/lib/permissions/engine";

const base: PermissionInput = {
  tool: { key: "mock_email.send_email", name: "Send email", riskLevel: "MEDIUM", capabilities: ["external_communication"], enabled: true, deleted: false },
  liveGrant: "ALLOW",
  agentPaused: false,
  policies: [],
  approvalRules: [],
  action: { toolKey: "mock_email.send_email", capabilities: ["external_communication"], risk: "MEDIUM", input: { to: "a@ext.com" }, agentId: "a1", departmentId: null, internalDomains: ["acme.com"] },
};

describe("permission engine", () => {
  it("allows a granted low-friction action", () => {
    expect(evaluatePermission(base).outcome).toBe("ALLOW");
  });

  it("denies unassigned tools", () => {
    expect(evaluatePermission({ ...base, liveGrant: null }).outcome).toBe("DENY");
  });

  it("denies when paused or tool disabled", () => {
    expect(evaluatePermission({ ...base, agentPaused: true }).outcome).toBe("DENY");
    expect(evaluatePermission({ ...base, tool: { ...base.tool, enabled: false } }).outcome).toBe("DENY");
  });

  it("company deny policy beats an agent ALLOW grant", () => {
    const d = evaluatePermission({
      ...base,
      policies: [{ id: "p", name: "No external comms", scope: "ORGANIZATION", enforcement: { type: "deny_capability", capability: "external_communication" } }],
    });
    expect(d.outcome).toBe("DENY");
    expect(d.reasons[0]).toContain("No external comms");
  });

  it("require-approval policy escalates an ALLOW grant", () => {
    const d = evaluatePermission({
      ...base,
      policies: [{ id: "p", name: "Ext needs approval", scope: "ORGANIZATION", enforcement: { type: "require_approval_capability", capability: "external_communication" } }],
    });
    expect(d.outcome).toBe("REQUIRE_APPROVAL");
  });

  it("department and agent policies apply too", () => {
    const d = evaluatePermission({ ...base, policies: [{ id: "p", name: "Low risk only", scope: "DEPARTMENT", enforcement: { type: "max_risk", risk: "LOW" } }] });
    expect(d.outcome).toBe("DENY");
    expect(d.checks.find((c) => c.outcome === "DENY")?.layer).toBe("department");
  });

  it("uses the stricter of live and published grants", () => {
    expect(evaluatePermission({ ...base, liveGrant: "ALLOW", snapshotGrant: "REQUIRE_APPROVAL" }).outcome).toBe("REQUIRE_APPROVAL");
    expect(evaluatePermission({ ...base, liveGrant: "DENY", snapshotGrant: "ALLOW" }).outcome).toBe("DENY");
    expect(evaluatePermission({ ...base, snapshotGrant: null }).outcome).toBe("DENY");
  });

  it("critical actions always need a human", () => {
    const d = evaluatePermission({ ...base, tool: { ...base.tool, riskLevel: "CRITICAL" } });
    expect(d.outcome).toBe("REQUIRE_APPROVAL");
  });

  it("applies approval rules against the concrete input", () => {
    const rule = { id: "r", name: "External email", effect: "REQUIRE_APPROVAL" as const, conditions: [{ field: "recipient" as const, op: "eq" as const, value: "external" }] };
    expect(evaluatePermission({ ...base, approvalRules: [rule] }).outcome).toBe("REQUIRE_APPROVAL");
    expect(evaluatePermission({ ...base, approvalRules: [rule], action: { ...base.action, input: { to: "sam@acme.com" } } }).outcome).toBe("ALLOW");
  });

  it("deny rules win over approval rules", () => {
    const d = evaluatePermission({
      ...base,
      approvalRules: [
        { id: "a", name: "approve", effect: "REQUIRE_APPROVAL", conditions: [{ field: "capability", op: "includes", value: "external_communication" }] },
        { id: "b", name: "block big", effect: "DENY", conditions: [{ field: "risk", op: "gte", value: "MEDIUM" }] },
      ],
    });
    expect(d.outcome).toBe("DENY");
  });
});
