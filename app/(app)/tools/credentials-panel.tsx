"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { KeyRound, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/forms/field";
import { ConfirmButton } from "@/components/common/confirm-button";
import { useAction } from "@/hooks/use-action";
import { createCredentialAction, revokeCredentialAction, rotateCredentialAction } from "./actions";

interface Cred {
  id: string;
  name: string;
  type: string;
  hint: string | null;
  revoked: boolean;
  rotatedAt: string | null;
  lastUsedAt: string | null;
  usage: number;
}

export const CREDENTIAL_TYPES = [
  { value: "API_KEY", label: "API key" },
  { value: "BEARER_TOKEN", label: "Bearer token" },
  { value: "BASIC_AUTH", label: "Basic auth (username:password)" },
  { value: "OAUTH2", label: "OAuth 2 access token" },
];

export function CredentialsPanel({ credentials }: { credentials: Cred[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="h-fit rounded-xl border bg-surface p-5 shadow-card" aria-labelledby="creds-title">
      <div className="flex items-center justify-between">
        <h2 id="creds-title" className="text-card-title">
          Credentials
        </h2>
        <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>
          <Plus aria-hidden /> Add
        </Button>
      </div>
      <p className="mt-1 text-[13px] text-text-secondary">Encrypted at rest. Write-only: secrets are never displayed again or sent to an AI model.</p>
      {adding && <NewCredentialForm onDone={() => setAdding(false)} />}
      <ul className="mt-4 grid gap-2">
        {credentials.length === 0 && <li className="text-[13px] text-text-muted">No credentials yet.</li>}
        {credentials.map((c) => (
          <CredentialRow key={c.id} c={c} />
        ))}
      </ul>
    </section>
  );
}

export function NewCredentialForm({ onDone, defaultType = "API_KEY" }: { onDone: (cred?: { id: string; name: string }) => void; defaultType?: string }) {
  const [v, setV] = useState({ name: "", type: defaultType, secret: "" });
  const create = useAction(createCredentialAction, { success: "Credential saved (encrypted).", onSuccess: (c) => onDone(c) });
  return (
    <form
      className="mt-4 grid gap-3 rounded-lg border bg-background p-3"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void create.run(v);
      }}
    >
      <Field label="Name" name="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={create.fieldErrors.name} placeholder="Orders API key" />
      <div className="grid gap-1.5">
        <Label className="text-[13px]">Type</Label>
        <Select value={v.type} onValueChange={(t) => setV({ ...v, type: t })}>
          <SelectTrigger className="h-10 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CREDENTIAL_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Field label="Secret" name="secret" type="password" autoComplete="off" value={v.secret} onChange={(e) => setV({ ...v, secret: e.target.value })} error={create.fieldErrors.secret} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={create.pending}>
          {create.pending && <Loader2 className="animate-spin" aria-hidden />} Save
        </Button>
      </div>
    </form>
  );
}

function CredentialRow({ c }: { c: Cred }) {
  const [rotating, setRotating] = useState(false);
  const [secret, setSecret] = useState("");
  const rotate = useAction(rotateCredentialAction, {
    success: "Credential rotated.",
    onSuccess: () => {
      setRotating(false);
      setSecret("");
    },
  });
  const revoke = useAction(revokeCredentialAction, { success: "Credential revoked." });
  return (
    <li className="rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 size-4 text-text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium">
            {c.name} {c.revoked && <Badge className="bg-danger-soft text-danger-text">Revoked</Badge>}
          </p>
          <p className="text-xs text-text-muted">
            {CREDENTIAL_TYPES.find((t) => t.value === c.type)?.label ?? c.type} · {c.hint ?? "••••"} · used by {c.usage}
            {c.lastUsedAt ? ` · last used ${formatDistanceToNow(new Date(c.lastUsedAt), { addSuffix: true })}` : ""}
            {c.rotatedAt ? ` · rotated ${formatDistanceToNow(new Date(c.rotatedAt), { addSuffix: true })}` : ""}
          </p>
        </div>
      </div>
      <div className="mt-2 flex justify-end gap-1">
        <Button size="xs" variant="ghost" onClick={() => setRotating((r) => !r)}>
          Rotate
        </Button>
        {!c.revoked && (
          <ConfirmButton size="xs" variant="ghost" destructive title={`Revoke ${c.name}?`} description="Every tool and provider using it stops working immediately." confirmLabel="Revoke" onConfirm={() => revoke.run(c.id)}>
            Revoke
          </ConfirmButton>
        )}
      </div>
      {rotating && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void rotate.run({ id: c.id, secret });
          }}
        >
          <input
            type="password"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="New secret"
            aria-label="New secret"
            autoComplete="off"
          />
          <Button size="sm" type="submit" disabled={rotate.pending || secret.length < 4}>
            Save
          </Button>
        </form>
      )}
    </li>
  );
}
