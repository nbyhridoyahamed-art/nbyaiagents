import { describe, expect, it } from "vitest";
import { conditionsMatch, extractRecipients, type ActionContext } from "@/lib/approvals/conditions";

const base: ActionContext = {
  toolKey: "mock_email.send_email",
  capabilities: ["external_communication"],
  risk: "MEDIUM",
  input: { to: "john@example.com", subject: "Hi" },
  agentId: "agent_1",
  departmentId: "dept_1",
  internalDomains: ["acme.com"],
};

describe("approval conditions", () => {
  it("matches action and external recipient (spec example)", () => {
    const conds = [
      { field: "action" as const, op: "eq" as const, value: "mock_email.send_email" },
      { field: "recipient" as const, op: "eq" as const, value: "external" },
    ];
    expect(conditionsMatch(conds, base)).toBe(true);
    expect(conditionsMatch(conds, { ...base, input: { to: "sam@acme.com" } })).toBe(false);
  });

  it("treats any external recipient in a list as external", () => {
    const conds = [{ field: "recipient" as const, op: "eq" as const, value: "external" }];
    expect(conditionsMatch(conds, { ...base, input: { to: ["a@acme.com", "b@other.io"] } })).toBe(true);
  });

  it("compares amounts numerically (IF amount > 100)", () => {
    const conds = [{ field: "amount" as const, op: "gt" as const, value: 100 }];
    expect(conditionsMatch(conds, { ...base, input: { amount: 150 } })).toBe(true);
    expect(conditionsMatch(conds, { ...base, input: { amount: "99.5" } })).toBe(false);
    expect(conditionsMatch(conds, { ...base, input: {} })).toBe(false);
  });

  it("orders risk levels", () => {
    const conds = [{ field: "risk" as const, op: "gte" as const, value: "HIGH" }];
    expect(conditionsMatch(conds, { ...base, risk: "MEDIUM" })).toBe(false);
    expect(conditionsMatch(conds, { ...base, risk: "HIGH" })).toBe(true);
    expect(conditionsMatch(conds, { ...base, risk: "CRITICAL" })).toBe(true);
  });

  it("checks capability membership", () => {
    expect(conditionsMatch([{ field: "capability", op: "includes", value: "external_communication" }], base)).toBe(true);
    expect(conditionsMatch([{ field: "capability", op: "includes", value: "financial" }], base)).toBe(false);
    expect(conditionsMatch([{ field: "capability", op: "not_includes", value: "financial" }], base)).toBe(true);
  });

  it("reads nested input paths", () => {
    const ctx = { ...base, input: { customer: { tier: "VIP" } } };
    expect(conditionsMatch([{ field: "input", path: "customer.tier", op: "eq", value: "vip" }], ctx)).toBe(true);
  });

  it("never matches with an empty condition list", () => {
    expect(conditionsMatch([], base)).toBe(false);
  });

  it("extracts recipients from mixed shapes", () => {
    expect(extractRecipients({ to: "A <a@x.com>", cc: ["b@y.com"], attendees: [{ email: "c@z.com" }] }).sort()).toEqual([
      "a@x.com",
      "b@y.com",
      "c@z.com",
    ]);
  });
});
