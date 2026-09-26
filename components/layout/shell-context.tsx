"use client";

import { createContext, useContext } from "react";
import type { OrgRole } from "@/lib/generated/prisma/enums";

export interface ShellData {
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean };
  org: { id: string; name: string; plan: string };
  role: OrgRole;
  organizations: { id: string; name: string }[];
  counts: { approvals: number; inbox: number; notifications: number };
}

const ShellContext = createContext<ShellData | null>(null);

export const ShellProvider = ShellContext.Provider;

export function useShell(): ShellData {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside the app shell");
  return ctx;
}
