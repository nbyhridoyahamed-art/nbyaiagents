"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-action";
import { addWebsiteAction } from "./actions";

export function AddWebsiteForm() {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [name, setName] = useState("");
  const add = useAction(addWebsiteAction, { success: "Website added.", refresh: false, onSuccess: (site) => router.push(`/websites/${site.id}`) });
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void add.run({ domain, name: name || undefined });
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="site-domain">Website address</Label>
        <Input id="site-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourbusiness.com" autoComplete="off" inputMode="url" aria-invalid={!!add.fieldErrors.domain} className="h-10" />
        {add.fieldErrors.domain && <p className="text-xs text-danger-text">{add.fieldErrors.domain}</p>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="site-name">Display name (optional)</Label>
        <Input id="site-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your Business" maxLength={80} autoComplete="off" className="h-10" />
      </div>
      <Button type="submit" className="h-10" disabled={add.pending || !domain.trim()}>
        {add.pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />} Add website
      </Button>
    </form>
  );
}
