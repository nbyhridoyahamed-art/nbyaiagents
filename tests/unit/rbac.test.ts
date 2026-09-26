import { describe, expect, it } from "vitest";
import { canAssignRole, roleHas } from "@/lib/permissions/rbac";

describe("RBAC", () => {
  it("viewers are read-only", () => {
    expect(roleHas("VIEWER", "agents:read")).toBe(true);
    expect(roleHas("VIEWER", "agents:write")).toBe(false);
    expect(roleHas("VIEWER", "approvals:decide")).toBe(false);
    expect(roleHas("VIEWER", "workflows:run")).toBe(false);
  });

  it("members can run work but not build or approve", () => {
    expect(roleHas("MEMBER", "tasks:write")).toBe(true);
    expect(roleHas("MEMBER", "workflows:run")).toBe(true);
    expect(roleHas("MEMBER", "agents:write")).toBe(false);
    expect(roleHas("MEMBER", "approvals:decide")).toBe(false);
  });

  it("only admins and owners manage credentials, policies and members", () => {
    for (const perm of ["credentials:manage", "policies:manage", "members:manage"] as const) {
      expect(roleHas("MANAGER", perm)).toBe(false);
      expect(roleHas("ADMIN", perm)).toBe(true);
      expect(roleHas("OWNER", perm)).toBe(true);
    }
  });

  it("billing is owner-only", () => {
    expect(roleHas("ADMIN", "billing:manage")).toBe(false);
    expect(roleHas("OWNER", "billing:manage")).toBe(true);
  });

  it("members can only assign roles below their own", () => {
    expect(canAssignRole("OWNER", "OWNER")).toBe(true);
    expect(canAssignRole("ADMIN", "OWNER")).toBe(false);
    expect(canAssignRole("ADMIN", "ADMIN")).toBe(false);
    expect(canAssignRole("ADMIN", "MANAGER")).toBe(true);
    expect(canAssignRole("MANAGER", "MEMBER")).toBe(false); // managers can't manage members at all
  });
});
