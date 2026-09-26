"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmButton } from "@/components/common/confirm-button";
import { useAction } from "@/hooks/use-action";
import { deleteToolAction, setToolEnabledAction, setToolRiskAction } from "../actions";

const ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export function ToolControls({
  toolId,
  enabled,
  kind,
  riskLevel,
  canManage,
  canSetRisk,
}: {
  toolId: string;
  enabled: boolean;
  kind: string;
  riskLevel: string;
  canManage: boolean;
  canSetRisk: boolean;
}) {
  const router = useRouter();
  const toggle = useAction(setToolEnabledAction, { success: enabled ? "Tool disabled." : "Tool enabled." });
  const risk = useAction(setToolRiskAction, { success: "Risk level updated." });
  const del = useAction(deleteToolAction, { refresh: false, success: "Tool deleted.", onSuccess: () => router.push("/tools") });
  if (!canManage) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="mr-2 flex items-center gap-2 text-[13px]">
        <Switch checked={enabled} onCheckedChange={(v) => void toggle.run({ toolId, enabled: v })} aria-label="Enable tool" /> {enabled ? "Enabled" : "Disabled"}
      </label>
      {canSetRisk && kind === "BUILTIN" && (
        <Select value={riskLevel} onValueChange={(r) => void risk.run({ toolId, riskLevel: r })}>
          <SelectTrigger className="h-9 w-40" aria-label="Risk level">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORDER.filter((r) => ORDER.indexOf(r) >= ORDER.indexOf(riskLevel)).map((r) => (
              <SelectItem key={r} value={r}>
                {r.charAt(0) + r.slice(1).toLowerCase()} risk
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {kind === "CUSTOM_HTTP" && (
        <>
          <Button asChild variant="outline">
            <Link href={`/tools/${toolId}?edit=1`}>
              <Pencil aria-hidden /> Edit
            </Link>
          </Button>
          <ConfirmButton variant="ghost" destructive title="Delete this tool?" description="It's removed from every employee immediately." confirmLabel="Delete" onConfirm={() => del.run(toolId)}>
            Delete
          </ConfirmButton>
        </>
      )}
    </div>
  );
}
