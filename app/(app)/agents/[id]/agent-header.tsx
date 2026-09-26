"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, Loader2, MessageSquare, MoreHorizontal, Pause, Play, Rocket, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { AgentStatusBadge } from "@/components/agents/agent-status";
import { useAction } from "@/hooks/use-action";
import { PROVIDER_LABELS, getModel } from "@/lib/ai/models";
import type { AgentLifecycle, AgentStatus, ProviderKind } from "@/lib/generated/prisma/enums";
import { deleteAgentAction, duplicateAgentAction, publishAgentAction, setAgentPausedAction } from "../actions";

interface HeaderAgent {
  id: string;
  name: string;
  jobTitle: string;
  department: string | null;
  color: string;
  status: AgentStatus;
  lifecycle: AgentLifecycle;
  publishedVersion: number | null;
  draftVersion: number;
  provider: ProviderKind;
  model: string;
}

export function AgentHeader({ agent, errors, canEdit, canPublish }: { agent: HeaderAgent; errors: number; canEdit: boolean; canPublish: boolean }) {
  const router = useRouter();
  const [publishOpen, setPublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const publish = useAction(publishAgentAction, {
    success: (d) => `${agent.name} v${d.version} is live.`,
    onSuccess: () => setPublishOpen(false),
  });
  const pause = useAction(setAgentPausedAction);
  const duplicate = useAction(duplicateAgentAction, { refresh: false, onSuccess: (d) => router.push(`/agents/${d.id}`), success: "Employee duplicated as a draft." });
  const remove = useAction(deleteAgentAction, { refresh: false, onSuccess: () => router.push("/agents"), success: `${agent.name} was removed.` });

  const unpublishedChanges = agent.publishedVersion !== null && agent.draftVersion > agent.publishedVersion;
  const paused = agent.status === "PAUSED";

  return (
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <AgentAvatar name={agent.name} color={agent.color} size={56} status={agent.status} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[26px] font-[650] leading-9 tracking-tight">{agent.name}</h1>
            <AgentStatusBadge status={agent.status} />
            {agent.lifecycle === "DRAFT" ? (
              <span className="rounded-md bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-text">Draft · not published</span>
            ) : (
              <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-secondary">
                v{agent.publishedVersion} live{unpublishedChanges ? " · unpublished changes" : ""}
              </span>
            )}
          </div>
          <p className="text-[13.5px] text-text-secondary">
            {agent.jobTitle}
            {agent.department ? ` · ${agent.department}` : ""} ·{" "}
            <span className={agent.provider === "OFFLINE" ? "text-warning-text" : undefined}>
              {agent.provider === "OFFLINE" ? "Offline demo model (not AI)" : `${PROVIDER_LABELS[agent.provider]} ${getModel(agent.model)?.label ?? agent.model}`}
            </span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="lg">
          <Link href={`/agents/${agent.id}?tab=chat`}>
            <MessageSquare aria-hidden /> Chat
          </Link>
        </Button>
        {canPublish && (agent.lifecycle === "DRAFT" || unpublishedChanges) && (
          <Button size="lg" onClick={() => setPublishOpen(true)} disabled={errors > 0} title={errors > 0 ? "Fix the readiness issues first" : undefined}>
            <Rocket aria-hidden /> Publish
          </Button>
        )}
        {canEdit && (
          <>
            <Button variant="outline" size="lg" onClick={() => void pause.run({ agentId: agent.id, paused: !paused })} disabled={pause.pending}>
              {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
              {paused ? "Resume" : "Pause"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-lg" aria-label="More actions">
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void duplicate.run(agent.id)}>
                  <Copy aria-hidden /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                  <Trash2 aria-hidden /> Remove employee
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish {agent.name}</DialogTitle>
            <DialogDescription>
              Publishing creates an immutable version. Live tasks and workflows use it; runs already in progress keep the version they started with.
            </DialogDescription>
          </DialogHeader>
          <Textarea placeholder="What changed? (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} aria-label="Version notes" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void publish.run({ agentId: agent.id, notes })} disabled={publish.pending}>
              {publish.pending ? <Loader2 className="animate-spin" aria-hidden /> : <Rocket aria-hidden />}
              Publish version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {agent.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {agent.name} stops working immediately and their schedules are disabled. Past runs, tasks and audit history are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-white hover:bg-danger/90"
              onClick={(e) => {
                e.preventDefault();
                void remove.run(agent.id).then((r) => {
                  if (!r.ok) toast.error(r.error);
                });
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
