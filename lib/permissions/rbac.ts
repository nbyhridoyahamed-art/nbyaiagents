import type { OrgRole } from "@/lib/generated/prisma/enums";

/**
 * Human (team member) permissions. Checked server-side on every mutation.
 * Named capabilities keep call sites readable and allow future fine-grained
 * authorization (custom roles) without touching every service.
 */
export const PERMISSIONS = [
  "org:read",
  "org:manage",
  "billing:manage",
  "members:read",
  "members:manage",
  "departments:manage",
  "agents:read",
  "agents:write",
  "agents:publish",
  "agents:chat",
  "knowledge:read",
  "knowledge:write",
  "tools:read",
  "tools:manage",
  "credentials:manage",
  "policies:manage",
  "tasks:read",
  "tasks:write",
  "workflows:read",
  "workflows:write",
  "workflows:publish",
  "workflows:run",
  "approvals:read",
  "approvals:decide",
  "analytics:read",
  "audit:read",
  "apikeys:manage",
  "templates:install",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = [
  "org:read",
  "members:read",
  "agents:read",
  "knowledge:read",
  "tools:read",
  "tasks:read",
  "workflows:read",
  "approvals:read",
  "analytics:read",
];

const MEMBER: Permission[] = [...VIEWER, "agents:chat", "tasks:write", "workflows:run", "knowledge:write"];

const MANAGER: Permission[] = [
  ...MEMBER,
  "agents:write",
  "agents:publish",
  "workflows:write",
  "workflows:publish",
  "approvals:decide",
  "tools:manage",
  "departments:manage",
  "templates:install",
];

const ADMIN: Permission[] = [
  ...MANAGER,
  "org:manage",
  "members:manage",
  "credentials:manage",
  "policies:manage",
  "audit:read",
  "apikeys:manage",
];

const OWNER: Permission[] = [...ADMIN, "billing:manage"];

export const ROLE_PERMISSIONS: Record<OrgRole, ReadonlySet<Permission>> = {
  OWNER: new Set(OWNER),
  ADMIN: new Set(ADMIN),
  MANAGER: new Set(MANAGER),
  MEMBER: new Set(MEMBER),
  VIEWER: new Set(VIEWER),
};

export function roleHas(role: OrgRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export const ROLE_RANK: Record<OrgRole, number> = { OWNER: 5, ADMIN: 4, MANAGER: 3, MEMBER: 2, VIEWER: 1 };

/** A member may only assign roles at or below their own (owners may assign anything). */
export function canAssignRole(actor: OrgRole, target: OrgRole): boolean {
  if (actor === "OWNER") return true;
  return roleHas(actor, "members:manage") && ROLE_RANK[target] < ROLE_RANK[actor];
}

export const ROLE_LABELS: Record<OrgRole, { label: string; description: string }> = {
  OWNER: { label: "Owner", description: "Full control, including billing and ownership." },
  ADMIN: { label: "Admin", description: "Manage the workspace, members, credentials and policies." },
  MANAGER: { label: "Manager", description: "Build and publish AI employees and workflows; decide approvals." },
  MEMBER: { label: "Member", description: "Chat with employees, create tasks and run workflows." },
  VIEWER: { label: "Viewer", description: "Read-only access." },
};
