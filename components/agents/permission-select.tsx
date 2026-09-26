"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type Effect = "ALLOW" | "REQUIRE_APPROVAL" | "DENY";

export const EFFECT_META: Record<Effect, { label: string; className: string }> = {
  ALLOW: { label: "Allowed", className: "text-success-text" },
  REQUIRE_APPROVAL: { label: "Requires approval", className: "text-warning-text" },
  DENY: { label: "Denied", className: "text-danger-text" },
};

export function PermissionSelect({ value, onChange, label, disabled }: { value: Effect; onChange: (v: Effect) => void; label: string; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Effect)} disabled={disabled}>
      <SelectTrigger className={cn("h-9 w-44 font-medium", EFFECT_META[value].className)} aria-label={`Permission for ${label}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(EFFECT_META) as Effect[]).map((e) => (
          <SelectItem key={e} value={e} className={EFFECT_META[e].className}>
            {EFFECT_META[e].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
