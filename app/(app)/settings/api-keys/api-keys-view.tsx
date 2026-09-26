"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, KeyRound, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmButton } from "@/components/common/confirm-button";
import { EmptyState } from "@/components/common/empty-state";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created: string;
  lastUsed: string;
  expires: string;
  state: "active" | "revoked" | "expired";
}

const EXPIRY = [
  { value: "90", label: "90 days" },
  { value: "30", label: "30 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
];

export function ApiKeysView({ keys, scopes }: { keys: KeyRow[]; scopes: { key: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>(["agents:read", "agents:run", "tasks:read"]);
  const [expiry, setExpiry] = useState("90");
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useAction(createApiKeyAction, { onSuccess: (d) => setCreated(d.key) });
  const revoke = useAction(revokeApiKeyAction, { success: "Key revoked. Requests using it now fail." });

  function reset() {
    setOpen(false);
    setCreated(null);
    setCopied(false);
    setName("");
  }

  return (
    <section className="rounded-[14px] border bg-surface shadow-card" aria-labelledby="keys-title">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 id="keys-title" className="text-card-title">
            API keys
          </h2>
          <p className="text-xs text-text-muted">Let other systems give your employees work and run workflows. Each key only has the permissions you choose.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden /> Create key
        </Button>
      </header>
      {keys.length === 0 ? (
        <div className="p-5">
          <EmptyState compact icon={KeyRound} title="No API keys yet" description="Create a key to connect another system. You'll see the key once — store it in a password manager or secret store." />
        </div>
      ) : (
        <ul className="divide-y">
          {keys.map((k) => (
            <li key={k.id} className={cn("flex flex-wrap items-center gap-3 px-5 py-3.5", k.state !== "active" && "opacity-60")}>
              <KeyRound className="size-4 shrink-0 text-text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">
                  {k.name} <span className="font-mono text-xs text-text-muted">{k.prefix}…</span>
                  {k.state !== "active" && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold capitalize text-text-secondary">{k.state}</span>}
                </p>
                <p className="text-xs text-text-muted">
                  {k.scopes.join(" · ")} — created {k.created} · last used {k.lastUsed} · expires {k.expires}
                </p>
              </div>
              {k.state === "active" && (
                <ConfirmButton
                  variant="outline"
                  size="sm"
                  destructive
                  title={`Revoke “${k.name}”?`}
                  description="Anything using this key stops working immediately. This can't be undone."
                  confirmLabel="Revoke key"
                  onConfirm={() => revoke.run(k.id)}
                >
                  Revoke
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : reset())}>
        <DialogContent>
          {created ? (
            <>
              <DialogHeader>
                <DialogTitle>Copy your key now</DialogTitle>
                <DialogDescription>This is the only time it&apos;s shown. We store only a fingerprint of it, so it can&apos;t be recovered — create a new key if you lose it.</DialogDescription>
              </DialogHeader>
              <div className="flex gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-[12px]">{created}</code>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy key"
                  onClick={() => {
                    void navigator.clipboard.writeText(created);
                    setCopied(true);
                    toast.success("Key copied");
                  }}
                >
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={reset}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void create.run({ name, scopes: selected as never, expiresInDays: expiry === "never" ? null : (Number(expiry) as 30 | 90 | 365) });
              }}
            >
              <DialogHeader>
                <DialogTitle>Create an API key</DialogTitle>
                <DialogDescription>Give it only the permissions the other system needs.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5">
                <Label htmlFor="key-name">Name</Label>
                <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website contact form" maxLength={80} aria-invalid={!!create.fieldErrors.name} />
                {create.fieldErrors.name && <p className="text-xs text-danger-text">{create.fieldErrors.name}</p>}
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-[13px] font-medium">Permissions</legend>
                {scopes.map((s) => (
                  <label key={s.key} className="flex items-start gap-2.5 text-[13px]">
                    <Checkbox checked={selected.includes(s.key)} onCheckedChange={(c) => setSelected((prev) => (c ? [...prev, s.key] : prev.filter((x) => x !== s.key)))} className="mt-0.5" />
                    <span>
                      <span className="font-mono text-[12px]">{s.key}</span> — {s.label}
                    </span>
                  </label>
                ))}
                {create.fieldErrors.scopes && <p className="text-xs text-danger-text">{create.fieldErrors.scopes}</p>}
              </fieldset>
              <div className="grid gap-1.5">
                <Label htmlFor="key-expiry">Expires</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger id="key-expiry" className="w-40">
                    <SelectValue>{EXPIRY.find((e) => e.value === expiry)?.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={reset}>
                  Cancel
                </Button>
                <Button type="submit" disabled={create.pending}>
                  {create.pending && <Loader2 className="animate-spin" aria-hidden />} Create key
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
