import type { Metadata } from "next";
import { format, formatDistanceToNow } from "date-fns";
import { requirePageContext } from "@/lib/auth/context";
import { env } from "@/lib/env";
import { API_SCOPES, listApiKeys } from "@/server/services/api-keys";
import { ApiKeysView } from "./api-keys-view";

export const metadata: Metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const ctx = await requirePageContext("apikeys:manage");
  const keys = await listApiKeys(ctx.org.id);
  const base = env().APP_URL;
  return (
    <div className="grid gap-6">
      <ApiKeysView
        scopes={Object.entries(API_SCOPES).map(([key, label]) => ({ key, label }))}
        keys={keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          scopes: k.scopes,
          created: format(k.createdAt, "PP"),
          lastUsed: k.lastUsedAt ? formatDistanceToNow(k.lastUsedAt, { addSuffix: true }) : "never",
          expires: k.expiresAt ? format(k.expiresAt, "PP") : "never",
          state: k.revokedAt ? "revoked" : k.expiresAt && k.expiresAt < new Date() ? "expired" : "active",
        }))}
      />
      <section className="rounded-[14px] border bg-surface p-5 shadow-card" aria-labelledby="api-ref">
        <h2 id="api-ref" className="text-card-title">
          API reference
        </h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          Send the key as <code className="rounded bg-surface-2 px-1">Authorization: Bearer nby_…</code>. Responses are JSON: <code className="rounded bg-surface-2 px-1">{"{ data }"}</code> on success,{" "}
          <code className="rounded bg-surface-2 px-1">{"{ error: { code, message } }"}</code> on failure. Each key allows 120 requests per minute.
        </p>
        <ul className="mt-4 grid gap-2 font-mono text-[12px]">
          {[
            ["GET", "/api/v1/agents", "agents:read"],
            ["POST", "/api/v1/agents/{agentId}/run", "agents:run"],
            ["GET", "/api/v1/tasks/{taskId}", "tasks:read"],
            ["GET", "/api/v1/workflows", "workflows:read"],
            ["POST", "/api/v1/workflows/{workflowId}/run", "workflows:run"],
            ["GET", "/api/v1/workflow-runs/{runId}", "workflows:read"],
            ["POST", "/api/webhooks/{key}", "signature or workflows:run"],
          ].map(([m, path, scope]) => (
            <li key={path} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
              <span className={m === "GET" ? "font-semibold text-info-text" : "font-semibold text-success-text"}>{m}</span>
              <span>{path}</span>
              <span className="ml-auto font-sans text-[11.5px] text-text-muted">{scope}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs font-semibold text-text-muted">Example: give an employee work</p>
        <pre className="mt-1 overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[11.5px]">{`curl -X POST ${base}/api/v1/agents/AGENT_ID/run \\
  -H "Authorization: Bearer $VDESKS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Research Globex and summarise their pricing"}'`}</pre>
        <p className="mt-3 text-[12.5px] text-text-secondary">
          Work runs in the background: poll the task link in the response. Actions that need approval pause and appear in Approvals, exactly as when a teammate starts the work.
        </p>
      </section>
    </div>
  );
}
