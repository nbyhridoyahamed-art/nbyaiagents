import { describe, expect, it } from "vitest";
import { createAgentSchema, onlySent } from "@/lib/agents/schema";

describe("onlySent", () => {
  it("drops the defaults Zod fills in for a partial update", () => {
    const sent = { model: { provider: "GROQ" as const, model: "openai/gpt-oss-120b" }, limits: { maxStepsPerRun: 20 } };
    const parsed = createAgentSchema.partial().parse(sent);

    // The trap: a "partial" parse still carries a blank role and the default look…
    expect(parsed).toMatchObject({ mission: "", responsibilities: [], goals: [], kpis: [], personality: "professional", priority: "MEDIUM", avatarColor: "#5B5FEF" });
    expect(parsed.limits).toMatchObject({ maxStepsPerRun: 20, maxToolCallsPerRun: 8, canDelegate: false });

    // …which onlySent removes, at the top level and inside limits.
    const patch = onlySent(parsed, sent);
    expect(Object.keys(patch).sort()).toEqual(["limits", "model"]);
    expect(onlySent(parsed.limits!, sent.limits)).toEqual({ maxStepsPerRun: 20 });
  });

  it("keeps fields that were sent empty, so they can be cleared on purpose", () => {
    const sent = { mission: "", goals: [], description: "", departmentId: null };
    const patch = onlySent(createAgentSchema.partial().parse(sent), sent);
    expect(patch).toEqual({ mission: "", goals: [], description: "", departmentId: null });
  });

  it("treats a key that is explicitly undefined as not sent", () => {
    expect(onlySent({ a: 1, b: 2 }, { a: undefined, b: 5 })).toEqual({ b: 2 });
  });

  it("keeps the validated (trimmed) value rather than the raw one", () => {
    const sent = { mission: "  Grow search traffic.  " };
    expect(onlySent(createAgentSchema.partial().parse(sent), sent)).toEqual({ mission: "Grow search traffic." });
  });
});
