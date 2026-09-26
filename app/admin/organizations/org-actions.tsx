"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAction } from "@/hooks/use-action";
import { setPlanAction, suspendOrgAction } from "../actions";

const PLANS = ["FREE", "STARTER", "GROWTH", "ENTERPRISE"] as const;

export function OrgActions({ org }: { org: { id: string; name: string; plan: string; suspended: boolean } }) {
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reason, setReason] = useState("");
  const plan = useAction(setPlanAction, { success: "Plan updated." });
  const suspend = useAction(suspendOrgAction, { success: org.suspended ? "Organization reactivated." : "Organization suspended.", onSuccess: () => setSuspendOpen(false) });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${org.name}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Plan</DropdownMenuLabel>
          {PLANS.map((p) => (
            <DropdownMenuItem key={p} disabled={p === org.plan} onSelect={() => void plan.run({ orgId: org.id, plan: p })}>
              {p.charAt(0) + p.slice(1).toLowerCase()} {p === org.plan && "(current)"}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {org.suspended ? (
            <DropdownMenuItem onSelect={() => void suspend.run({ orgId: org.id, suspended: false })}>Reactivate</DropdownMenuItem>
          ) : (
            <DropdownMenuItem variant="destructive" onSelect={() => setSuspendOpen(true)}>
              Suspend…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend {org.name}?</DialogTitle>
            <DialogDescription>Members are blocked, API keys and webhooks stop working and schedules pause. Nothing is deleted, and you can reactivate at any time.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="suspend-reason">Reason (recorded in the audit log)</Label>
            <Textarea id="suspend-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            {suspend.fieldErrors.reason && <p className="text-xs text-danger-text">{suspend.fieldErrors.reason}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={suspend.pending} onClick={() => void suspend.run({ orgId: org.id, suspended: true, reason })}>
              Suspend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
