"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Eye, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/common/confirm-button";
import { useAction } from "@/hooks/use-action";
import { revealWebhookSecretAction, rotateWebhookSecretAction } from "@/app/(app)/workflows/actions";

/** Signing secret for a workflow's webhook: reveal, copy, rotate — plus how to sign. */
export function WebhookSecret({ workflowId, canManage }: { workflowId: string; canManage: boolean }) {
  const [secret, setSecret] = useState<string | null>(null);
  const reveal = useAction(revealWebhookSecretAction, { refresh: false, onSuccess: (d) => setSecret(d.secret) });
  const rotate = useAction(rotateWebhookSecretAction, { refresh: false, success: "New secret created. Update the sending system — the old one no longer works.", onSuccess: (d) => setSecret(d.secret) });

  return (
    <div className="grid gap-1.5">
      <p className="text-[11px] text-text-muted">
        Sign each request with <code className="font-mono">X-NBY-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex HMAC-SHA256 of &quot;t.body&quot;&gt;</code>, or send a <code className="font-mono">workflows:run</code> API key. Add an{" "}
        <code className="font-mono">Idempotency-Key</code> header so retries never run twice.
      </p>
      {canManage && (
        <>
          {secret ? (
            <div className="flex gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1 font-mono text-[11px]">{secret}</code>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Copy signing secret"
                onClick={() => {
                  void navigator.clipboard.writeText(secret);
                  toast.success("Secret copied");
                }}
              >
                <Copy aria-hidden />
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void reveal.run(workflowId)} disabled={reveal.pending}>
              <Eye aria-hidden /> Reveal signing secret
            </Button>
          )}
          <ConfirmButton
            variant="ghost"
            size="sm"
            title="Rotate the signing secret?"
            description="A new secret is created and the current one stops working immediately. Requests signed with the old secret will be rejected."
            confirmLabel="Rotate secret"
            onConfirm={() => rotate.run(workflowId)}
          >
            <RotateCw aria-hidden /> Rotate secret
          </ConfirmButton>
        </>
      )}
    </div>
  );
}
