"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmButton } from "@/components/common/confirm-button";
import { useAction } from "@/hooks/use-action";
import { deleteWebsiteAction, runSiteAuditAction, unlinkPropertyAction } from "./actions";

export function UnlinkButton({ websiteId, kind, product }: { websiteId: string; kind: "search_console" | "analytics"; product: string }) {
  const unlink = useAction(unlinkPropertyAction, { success: `${product} unlinked.` });
  return (
    <ConfirmButton
      size="sm"
      variant="ghost"
      title={`Unlink ${product}?`}
      description={`AI employees will no longer be able to read ${product} data for this website until you link a property again.`}
      confirmLabel="Unlink"
      onConfirm={() => unlink.run({ id: websiteId, kind })}
    >
      Unlink
    </ConfirmButton>
  );
}

export function DeleteWebsiteButton({ websiteId, domain }: { websiteId: string; domain: string }) {
  const router = useRouter();
  const remove = useAction(deleteWebsiteAction, { success: "Website removed.", refresh: false, onSuccess: () => router.push("/websites") });
  return (
    <ConfirmButton
      size="sm"
      variant="outline"
      destructive
      title={`Remove ${domain}?`}
      description="This only removes it from Virtual Desks Online. Your Google Search Console and Analytics data are not touched, and past audits stay in Tasks."
      confirmLabel="Remove website"
      onConfirm={() => remove.run(websiteId)}
    >
      Remove website
    </ConfirmButton>
  );
}

/** Hands the audit to an AI employee, with this website's exact properties written into the brief. */
export function RunAudit({ websiteId, employees }: { websiteId: string; employees: { id: string; name: string; jobTitle: string }[] }) {
  const router = useRouter();
  const [agentId, setAgentId] = useState(employees[0]?.id ?? "");
  const audit = useAction(runSiteAuditAction, { success: "Audit started.", refresh: false, onSuccess: (r) => router.push(`/tasks/${r.taskId}`) });
  if (!employees.length) {
    return <p className="text-[13px] text-text-secondary">Hire an AI employee first, then they can run this audit.</p>;
  }
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Select value={agentId} onValueChange={setAgentId}>
        <SelectTrigger className="h-10 w-full sm:w-72" aria-label="Who should run the audit?">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {employees.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name} · {e.jobTitle}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button onClick={() => void audit.run({ id: websiteId, agentId })} disabled={!agentId || audit.pending}>
        {audit.pending ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />} Run site audit
      </Button>
    </div>
  );
}
