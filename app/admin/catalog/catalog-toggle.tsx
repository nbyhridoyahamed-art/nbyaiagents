"use client";

import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { setCatalogEnabledAction } from "../actions";

export function CatalogToggle({ kind, itemKey, name, enabled }: { kind: "integrations" | "templates"; itemKey: string; name: string; enabled: boolean }) {
  const toggle = useAction(setCatalogEnabledAction, { success: `${name} ${enabled ? "turned off" : "turned on"} for everyone.` });
  return (
    <label className="flex items-center gap-2 text-xs text-text-secondary">
      {enabled ? "On" : "Off"}
      <Switch checked={enabled} disabled={toggle.pending} onCheckedChange={(v) => void toggle.run({ kind, key: itemKey, enabled: v })} aria-label={`${name} available`} />
    </label>
  );
}
