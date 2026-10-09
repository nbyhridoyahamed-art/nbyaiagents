"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  BarChart3,
  Calendar,
  Code2,
  Contact,
  FileText,
  Folder,
  GitBranch,
  GitMerge,
  Loader2,
  Mail,
  MessageSquare,
  Search,
  Sheet,
  ShoppingBag,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ConfirmButton } from "@/components/common/confirm-button";
import { useAction } from "@/hooks/use-action";
import type { IntegrationInfo } from "@/lib/integrations/catalog";
import { connectGitHubAction, connectIntegrationAction, connectShopifyAction, connectWebSearchAction, disconnectIntegrationAction } from "../tools/actions";

const ICONS: Record<string, LucideIcon> = {
  contact: Contact,
  mail: Mail,
  calendar: Calendar,
  search: Search,
  sheet: Sheet,
  "shopping-bag": ShoppingBag,
  code: Code2,
  webhook: Webhook,
  folder: Folder,
  "message-square": MessageSquare,
  "file-text": FileText,
  github: GitBranch,
  gitlab: GitMerge,
  "bar-chart": BarChart3,
};

type Row = IntegrationInfo & {
  disabledByPlatform?: boolean;
  configured?: boolean;
  connection: { id: string; status: string; isSimulated: boolean; connectedAt: string; tools: number; lastError: string | null } | null;
};

const CATEGORIES = ["CRM", "Communication", "Productivity", "Data", "Commerce", "Marketing", "Research", "Development", "Custom"] as const;

/** Surfaces the result of an OAuth/Shopify redirect (?connected=1 | ?error=...) as a toast, then cleans the URL. */
function useConnectionResultToast() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const error = params.get("error");
    const connected = params.get("connected");
    if (!error && !connected) return;
    if (error) toast.error(error);
    else toast.success("Connected.");
    router.replace("/integrations");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once for the params this page loaded with
  }, []);
}

export function IntegrationsGrid({ integrations, canManage }: { integrations: Row[]; canManage: boolean }) {
  useConnectionResultToast();
  return (
    <div className="grid gap-8">
      {CATEGORIES.map((cat) => {
        const items = integrations.filter((i) => i.category === cat);
        if (!items.length) return null;
        return (
          <section key={cat} aria-labelledby={`cat-${cat}`}>
            <h2 id={`cat-${cat}`} className="mb-3 text-eyebrow text-text-muted">
              {cat}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((i) => (
                <IntegrationCard key={i.key} i={i} canManage={canManage} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function StatusBadge({ i }: { i: Row }) {
  if (i.disabledByPlatform) return <Badge className="bg-danger-soft text-danger-text">Turned off by platform admin</Badge>;
  if (i.connection?.status === "CONNECTED") {
    return <Badge className="bg-success-soft text-success-text">{i.connection.isSimulated ? "Connected · simulated" : "Connected"}</Badge>;
  }
  if (i.connection?.status === "NEEDS_REAUTH") return <Badge className="bg-warning-soft text-warning-text">Needs reauthorization</Badge>;
  if (i.connection?.status === "ERROR") return <Badge className="bg-danger-soft text-danger-text">Error</Badge>;
  if (i.connection?.status === "DISCONNECTED") return <Badge variant="secondary">Disconnected</Badge>;
  if (i.availability === "requires_setup") {
    if (i.key === "web_search" && !i.configured) return <Badge variant="secondary">Needs API key</Badge>;
    return i.configured ? <Badge variant="outline">Available</Badge> : <Badge variant="secondary">Not configured</Badge>;
  }
  if (i.availability === "coming_soon") return <Badge variant="secondary">Coming soon</Badge>;
  return <Badge variant="outline">Available</Badge>;
}

function IntegrationCard({ i, canManage }: { i: Row; canManage: boolean }) {
  const Icon = ICONS[i.icon] ?? Code2;
  const connect = useAction(connectIntegrationAction, { success: `${i.name} connected.` });
  const disconnect = useAction(disconnectIntegrationAction, { success: `${i.name} disconnected.` });
  const connected = i.connection?.status === "CONNECTED";
  return (
    <li className="flex flex-col rounded-xl border bg-surface p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-text-secondary">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-card-title">{i.name}</p>
            {i.simulated && <Badge className="bg-ai-soft text-ai">Simulated</Badge>}
          </div>
          <p className="text-[13px] text-text-secondary">{i.description}</p>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <StatusBadge i={i} />
        {i.key === "custom_http" ? (
          <Button asChild size="sm" variant="outline">
            <Link href="/tools/new">Build a tool</Link>
          </Button>
        ) : i.key === "webhook" ? (
          <Button asChild size="sm" variant="outline">
            <Link href="/workflows">Use in a workflow</Link>
          </Button>
        ) : connected ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">{i.connection?.tools} tools</span>
            {canManage && (
              <ConfirmButton size="sm" variant="ghost" title={`Disconnect ${i.name}?`} description="Its tools stop working immediately. Employee permissions are kept for when you reconnect." confirmLabel="Disconnect" onConfirm={() => disconnect.run(i.key)}>
                Disconnect
              </ConfirmButton>
            )}
          </div>
        ) : i.disabledByPlatform ? null : i.availability === "available" && canManage ? (
          <Button size="sm" onClick={() => void connect.run(i.key)} disabled={connect.pending}>
            {connect.pending && <Loader2 className="animate-spin" aria-hidden />} {i.connection ? "Reconnect" : "Connect"}
          </Button>
        ) : i.availability === "requires_setup" && canManage && i.authType === "oauth2" && i.configured ? (
          <Button asChild size="sm">
            <a href={`/api/integrations/${i.provider}/authorize`}>{i.connection ? "Reconnect" : "Connect"}</a>
          </Button>
        ) : i.availability === "requires_setup" && canManage && i.authType === "platform_key" && i.configured ? (
          <Button size="sm" onClick={() => void connect.run(i.key)} disabled={connect.pending}>
            {connect.pending && <Loader2 className="animate-spin" aria-hidden />} {i.connection ? "Reconnect" : "Connect"}
          </Button>
        ) : i.availability === "requires_setup" && canManage && i.authType === "credential" ? (
          i.key === "github" ? <GitHubConnectForm /> : <ShopifyConnectForm />
        ) : i.key === "web_search" && canManage && !i.configured ? (
          <WebSearchConnectForm />
        ) : i.availability === "requires_setup" ? (
          <span className="text-right text-[11px] text-text-muted">Operator must set {i.setupEnv?.[0]}</span>
        ) : null}
      </div>
    </li>
  );
}

/** GitHub: the company pastes a fine-grained personal access token (no OAuth app to register). */
function GitHubConnectForm() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const connect = useAction(connectGitHubAction, { success: "GitHub connected." });

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Connect
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void connect.run({ token }).then((res) => {
          if (res.ok) {
            setToken("");
            setOpen(false);
          }
        });
      }}
    >
      <Input type="password" autoComplete="off" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} aria-label="GitHub access token" required />
      {connect.fieldErrors.token && <p className="text-xs text-danger-text">{connect.fieldErrors.token}</p>}
      <p className="text-xs text-text-muted">
        Create a{" "}
        <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer" className="underline">
          fine-grained token
        </a>{" "}
        limited to the repositories you choose, with Contents (read), Issues (read and write) and Pull requests (read). It&apos;s checked with GitHub, stored encrypted and never shown again.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={connect.pending}>
          {connect.pending && <Loader2 className="animate-spin" aria-hidden />} Connect
        </Button>
      </div>
    </form>
  );
}

/** Web Search needs only the company's own Tavily API key (the platform operator may also set one for everyone). */
function WebSearchConnectForm() {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const connect = useAction(connectWebSearchAction, { success: "Web Search connected." });

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Connect
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void connect.run({ apiKey }).then((res) => {
          if (res.ok) {
            setApiKey("");
            setOpen(false);
          }
        });
      }}
    >
      <Input type="password" autoComplete="off" placeholder="tvly-…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} aria-label="Tavily API key" required />
      {connect.fieldErrors.apiKey && <p className="text-xs text-danger-text">{connect.fieldErrors.apiKey}</p>}
      <p className="text-xs text-text-muted">
        Get a free key at{" "}
        <a href="https://app.tavily.com" target="_blank" rel="noopener noreferrer" className="underline">
          app.tavily.com
        </a>
        . It&apos;s checked with Tavily, stored encrypted and never shown again.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={connect.pending}>
          {connect.pending && <Loader2 className="animate-spin" aria-hidden />} Connect
        </Button>
      </div>
    </form>
  );
}

/** Shopify has no OAuth app to register — each org pastes its own store's Admin API access token. */
function ShopifyConnectForm() {
  const [open, setOpen] = useState(false);
  const [shop, setShop] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const connect = useAction(connectShopifyAction, { success: "Shopify connected." });

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Connect
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void connect.run({ shop, accessToken }).then((res) => res.ok && setOpen(false));
      }}
    >
      <Input placeholder="my-store.myshopify.com" value={shop} onChange={(e) => setShop(e.target.value)} aria-label="Shopify store domain" required />
      {connect.fieldErrors.shop && <p className="text-xs text-danger-text">{connect.fieldErrors.shop}</p>}
      <Input type="password" placeholder="Admin API access token" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} aria-label="Shopify Admin API access token" required />
      {connect.fieldErrors.accessToken && <p className="text-xs text-danger-text">{connect.fieldErrors.accessToken}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={connect.pending}>
          {connect.pending && <Loader2 className="animate-spin" aria-hidden />} Connect
        </Button>
      </div>
    </form>
  );
}
