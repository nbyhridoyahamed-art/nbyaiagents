"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormError } from "@/components/forms/field";
import { useAction } from "@/hooks/use-action";
import { HTTP_METHODS, httpInputJsonSchema, suggestedRisk, type HttpConfig, type HttpParameter } from "@/lib/tools/http-config";
import { CAPABILITIES, type Capability } from "@/lib/policies/types";
import { NewCredentialForm } from "@/app/(app)/tools/credentials-panel";
import { saveCustomToolAction } from "@/app/(app)/tools/actions";

type Risk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface BuilderInitial {
  toolId?: string;
  name: string;
  key: string;
  description: string;
  riskLevel: Risk;
  capabilities: Capability[];
  httpConfig: HttpConfig;
}

const EMPTY: BuilderInitial = {
  name: "",
  key: "",
  description: "",
  riskLevel: "LOW",
  capabilities: ["read_only"],
  httpConfig: { method: "GET", url: "https://", parameters: [], headers: [], bodyType: "json", auth: { type: "none" }, timeoutMs: 20000 },
};

export function RestToolBuilder({ initial, credentials }: { initial?: BuilderInitial; credentials: { id: string; name: string; hint: string | null }[] }) {
  const router = useRouter();
  const [v, setV] = useState<BuilderInitial>(initial ?? EMPTY);
  const [creds, setCreds] = useState(credentials);
  const [addingCred, setAddingCred] = useState(false);
  const cfg = v.httpConfig;
  const setCfg = (patch: Partial<HttpConfig>) => setV((p) => ({ ...p, httpConfig: { ...p.httpConfig, ...patch } }));
  const save = useAction(saveCustomToolAction, {
    success: initial?.toolId ? "Tool updated (new version)." : "Tool created. Grant it to employees from their Tools tab.",
    onSuccess: (d) => router.push(`/tools/${d.id}`),
  });

  const pathParams = useMemo(() => [...cfg.url.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]), [cfg.url]);
  const schemaPreview = useMemo(() => JSON.stringify({ name: `custom.${(v.key || v.name).toLowerCase().replace(/[^a-z0-9_]+/g, "_")}`, description: v.description, parameters: httpInputJsonSchema(cfg.parameters) }, null, 2), [v.key, v.name, v.description, cfg.parameters]);

  function updateParam(i: number, patch: Partial<HttpParameter>) {
    setCfg({ parameters: cfg.parameters.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });
  }

  return (
    <form
      className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run({ toolId: initial?.toolId, name: v.name, key: v.key, description: v.description, riskLevel: v.riskLevel, capabilities: v.capabilities, httpConfig: cfg });
      }}
    >
      <div className="grid content-start gap-6">
        <FormError message={save.error} />
        <section className="grid gap-4 rounded-xl border bg-surface p-5 shadow-card">
          <h2 className="text-card-title">Tool</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tool name" name="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={save.fieldErrors.name} placeholder="Check Order Status" />
            <Field label="Key" name="key" value={v.key} onChange={(e) => setV({ ...v, key: e.target.value })} disabled={!!initial?.toolId} hint="Used as the function name the AI sees." placeholder="check_order_status" />
          </div>
          <Field label="Description (what it does and when to use it)" name="description" multiline rows={2} defaultValue={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} error={save.fieldErrors.description} />
        </section>

        <section className="grid gap-4 rounded-xl border bg-surface p-5 shadow-card">
          <h2 className="text-card-title">Request</h2>
          <div className="grid gap-3 sm:grid-cols-[130px_minmax(0,1fr)]">
            <div className="grid gap-1.5">
              <Label className="text-[13px]">Method</Label>
              <Select
                value={cfg.method}
                onValueChange={(m) => {
                  const method = m as HttpConfig["method"];
                  setCfg({ method });
                  if (!initial?.toolId) setV((p) => ({ ...p, riskLevel: suggestedRisk(method), capabilities: method === "GET" ? ["read_only"] : method === "DELETE" ? ["data_deletion"] : ["data_modification"], httpConfig: { ...p.httpConfig, method } }));
                }}
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HTTP_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Field label="URL" name="url" value={cfg.url} onChange={(e) => setCfg({ url: e.target.value })} placeholder="https://api.example.com/orders/{order_id}" hint="Use {name} for path parameters." />
          </div>
          {pathParams.filter((p) => !cfg.parameters.some((x) => x.name === p)).length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-info-soft px-3 py-2 text-xs text-info-text">
              URL uses {pathParams.map((p) => `{${p}}`).join(", ")}.
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() =>
                  setCfg({
                    parameters: [...cfg.parameters, ...pathParams.filter((p) => !cfg.parameters.some((x) => x.name === p)).map((name) => ({ name, in: "path" as const, type: "string" as const, required: true, description: "" }))],
                  })
                }
              >
                Add as path parameters
              </Button>
            </div>
          )}

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium">Parameters the AI fills in</legend>
            {cfg.parameters.map((p, i) => (
              <div key={i} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_100px_100px_auto_auto]">
                <Input className="h-9" value={p.name} onChange={(e) => updateParam(i, { name: e.target.value })} placeholder="name" aria-label="Parameter name" />
                <Select value={p.in} onValueChange={(x) => updateParam(i, { in: x as HttpParameter["in"] })}>
                  <SelectTrigger className="h-9 w-full" aria-label="Location">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["path", "query", "body", "header"].map((x) => (
                      <SelectItem key={x} value={x}>
                        {x}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={p.type} onValueChange={(x) => updateParam(i, { type: x as HttpParameter["type"] })}>
                  <SelectTrigger className="h-9 w-full" aria-label="Type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["string", "number", "integer", "boolean"].map((x) => (
                      <SelectItem key={x} value={x}>
                        {x}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox checked={p.required} onCheckedChange={(c) => updateParam(i, { required: !!c })} /> required
                </label>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setCfg({ parameters: cfg.parameters.filter((_, idx) => idx !== i) })} aria-label="Remove parameter">
                  <X aria-hidden />
                </Button>
                <Input className="h-9 sm:col-span-5" value={p.description} onChange={(e) => updateParam(i, { description: e.target.value })} placeholder="Description the AI sees (e.g. The customer's order number)" aria-label="Parameter description" />
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setCfg({ parameters: [...cfg.parameters, { name: "", in: cfg.method === "GET" ? "query" : "body", type: "string", required: false, description: "" }] })}>
              <Plus aria-hidden /> Add parameter
            </Button>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium">Static headers (no secrets)</legend>
            {cfg.headers.map((h, i) => (
              <div key={i} className="flex gap-2">
                <Input className="h-9" value={h.name} onChange={(e) => setCfg({ headers: cfg.headers.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)) })} placeholder="Header" aria-label="Header name" />
                <Input className="h-9" value={h.value} onChange={(e) => setCfg({ headers: cfg.headers.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)) })} placeholder="Value" aria-label="Header value" />
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setCfg({ headers: cfg.headers.filter((_, idx) => idx !== i) })} aria-label="Remove header">
                  <X aria-hidden />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setCfg({ headers: [...cfg.headers, { name: "", value: "" }] })}>
              <Plus aria-hidden /> Add header
            </Button>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            {cfg.method !== "GET" && cfg.method !== "DELETE" && (
              <div className="grid gap-1.5">
                <Label className="text-[13px]">Body format</Label>
                <Select value={cfg.bodyType} onValueChange={(b) => setCfg({ bodyType: b as "json" | "form" })}>
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="form">Form (x-www-form-urlencoded)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <Field label="Response field (optional)" name="responsePath" value={cfg.responsePath ?? ""} onChange={(e) => setCfg({ responsePath: e.target.value || undefined })} placeholder="data.order" hint="Return only this part of the JSON response." />
          </div>
        </section>

        <section className="grid gap-4 rounded-xl border bg-surface p-5 shadow-card">
          <h2 className="text-card-title">Authentication</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-[13px]">Method</Label>
              <Select value={cfg.auth.type} onValueChange={(t) => setCfg({ auth: { ...cfg.auth, type: t as HttpConfig["auth"]["type"] } })}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="bearer">Bearer token</SelectItem>
                  <SelectItem value="api_key">API key</SelectItem>
                  <SelectItem value="basic">Basic auth</SelectItem>
                  <SelectItem value="oauth2">OAuth 2 access token</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {cfg.auth.type !== "none" && (
              <div className="grid gap-1.5">
                <Label className="text-[13px]">Credential</Label>
                <Select value={cfg.auth.credentialId ?? ""} onValueChange={(c) => (c === "__new" ? setAddingCred(true) : setCfg({ auth: { ...cfg.auth, credentialId: c } }))}>
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue placeholder="Choose a stored credential" />
                  </SelectTrigger>
                  <SelectContent>
                    {creds.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} {c.hint}
                      </SelectItem>
                    ))}
                    <SelectItem value="__new">+ New credential…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {cfg.auth.type === "api_key" && (
              <>
                <div className="grid gap-1.5">
                  <Label className="text-[13px]">Send key in</Label>
                  <Select value={cfg.auth.location ?? "header"} onValueChange={(l) => setCfg({ auth: { ...cfg.auth, location: l as "header" | "query" } })}>
                    <SelectTrigger className="h-10 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="header">Header</SelectItem>
                      <SelectItem value="query">Query parameter</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Field label="Header / parameter name" name="keyName" value={cfg.auth.keyName ?? ""} onChange={(e) => setCfg({ auth: { ...cfg.auth, keyName: e.target.value } })} placeholder="X-API-Key" />
              </>
            )}
          </div>
          {addingCred && (
            <NewCredentialForm
              defaultType={cfg.auth.type === "basic" ? "BASIC_AUTH" : cfg.auth.type === "api_key" ? "API_KEY" : cfg.auth.type === "oauth2" ? "OAUTH2" : "BEARER_TOKEN"}
              onDone={(c) => {
                setAddingCred(false);
                if (c) {
                  setCreds((prev) => [...prev, { id: c.id, name: c.name, hint: null }]);
                  setCfg({ auth: { ...cfg.auth, credentialId: c.id } });
                }
              }}
            />
          )}
          <p className="text-xs text-text-muted">The secret is injected server-side at request time. It never appears in the model&apos;s context, run logs or exports.</p>
        </section>

        <section className="grid gap-4 rounded-xl border bg-surface p-5 shadow-card">
          <h2 className="text-card-title">Risk &amp; capabilities</h2>
          <p className="-mt-2 text-[13px] text-text-secondary">These drive runtime policy: e.g. “External communication” tools need approval under your default company policy.</p>
          <div className="grid gap-1.5 sm:w-60">
            <Label className="text-[13px]">Risk level</Label>
            <Select value={v.riskLevel} onValueChange={(r) => setV({ ...v, riskLevel: r as Risk })}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as Risk[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {r.charAt(0) + r.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(CAPABILITIES) as Capability[]).map((c) => (
              <label key={c} className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={v.capabilities.includes(c)} onCheckedChange={(on) => setV({ ...v, capabilities: on ? [...v.capabilities, c] : v.capabilities.filter((x) => x !== c) })} />
                {CAPABILITIES[c]}
              </label>
            ))}
          </div>
        </section>
        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={save.pending}>
            {save.pending && <Loader2 className="animate-spin" aria-hidden />} {initial?.toolId ? "Save new version" : "Create tool"}
          </Button>
        </div>
      </div>
      <aside className="xl:sticky xl:top-24 xl:self-start">
        <section className="rounded-xl border bg-surface p-5 shadow-card">
          <h2 className="text-card-title">What the AI sees</h2>
          <p className="text-xs text-text-muted">Generated schema. Inputs are validated against it before every call.</p>
          <pre className="mt-3 max-h-[480px] overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11.5px] leading-5">{schemaPreview}</pre>
        </section>
      </aside>
    </form>
  );
}
