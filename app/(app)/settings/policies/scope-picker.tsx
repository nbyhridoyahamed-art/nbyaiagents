"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type Scope = "ORGANIZATION" | "DEPARTMENT" | "AGENT";

export function ScopePicker({
  scope,
  departmentId,
  agentId,
  departments,
  agents,
  onChange,
}: {
  scope: Scope;
  departmentId: string | null;
  agentId: string | null;
  departments: { id: string; name: string }[];
  agents: { id: string; name: string }[];
  onChange: (v: { scope: Scope; departmentId: string | null; agentId: string | null }) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label className="text-[13px]">Applies to</Label>
        <Select value={scope} onValueChange={(v) => onChange({ scope: v as Scope, departmentId: null, agentId: null })}>
          <SelectTrigger className="h-10 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ORGANIZATION">Whole company</SelectItem>
            <SelectItem value="DEPARTMENT">A department</SelectItem>
            <SelectItem value="AGENT">One AI employee</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {scope === "DEPARTMENT" && (
        <div className="grid gap-1.5">
          <Label className="text-[13px]">Department</Label>
          <Select value={departmentId ?? ""} onValueChange={(v) => onChange({ scope, departmentId: v, agentId: null })}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue placeholder="Choose department" />
            </SelectTrigger>
            <SelectContent>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {scope === "AGENT" && (
        <div className="grid gap-1.5">
          <Label className="text-[13px]">AI employee</Label>
          <Select value={agentId ?? ""} onValueChange={(v) => onChange({ scope, departmentId: null, agentId: v })}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue placeholder={agents.length ? "Choose employee" : "No employees yet"} />
            </SelectTrigger>
            <SelectContent>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
