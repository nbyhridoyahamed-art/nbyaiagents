/**
 * Who is performing an operation. Services take an Actor instead of reading
 * request state so they work identically from pages, the API, and the worker.
 */
export interface Actor {
  orgId: string;
  userId?: string | null;
  agentId?: string | null;
  apiKeyId?: string | null;
  type: "USER" | "AGENT" | "SYSTEM" | "API_KEY";
}

export function userActor(orgId: string, userId: string): Actor {
  return { orgId, userId, type: "USER" };
}

export function systemActor(orgId: string): Actor {
  return { orgId, type: "SYSTEM" };
}
