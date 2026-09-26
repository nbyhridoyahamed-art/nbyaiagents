import type { Metadata } from "next";
import { CheckCircle2, XCircle } from "lucide-react";
import { getSystemHealth } from "@/server/services/admin";

export const metadata: Metadata = { title: "System health" };
export const dynamic = "force-dynamic";

function Row({ label, ok, value }: { label: string; ok: boolean | null; value: string }) {
  return (
    <li className="flex items-center gap-3 px-5 py-3 text-[13.5px]">
      {ok === null ? <span className="size-4" /> : ok ? <CheckCircle2 className="size-4 text-success" aria-label="OK" /> : <XCircle className="size-4 text-danger" aria-label="Problem" />}
      <span className="flex-1">{label}</span>
      <span className="text-text-secondary">{value}</span>
    </li>
  );
}

export default async function AdminHealthPage() {
  const h = await getSystemHealth();
  const yes = (b: boolean) => (b ? "configured" : "not set");
  return (
    <div className="grid gap-6">
      <h1 className="text-page-title">System health</h1>
      <section className="rounded-[14px] border bg-surface shadow-card" aria-labelledby="h-core">
        <h2 id="h-core" className="border-b px-5 py-3 text-card-title">
          Core
        </h2>
        <ul className="divide-y">
          <Row label="Database" ok={h.database.ok} value={h.database.ok ? `${h.database.latencyMs} ms` : "unreachable"} />
          <Row label={`Job queue (${h.queue.driver})`} ok={h.queue.workerOk} value={`${h.queue.pending} waiting · ${h.queue.running} running · ${h.queue.processed5m} done in 5 min`} />
          <Row label="Oldest waiting job" ok={h.queue.oldestPendingSec < 120} value={h.queue.pending ? `${h.queue.oldestPendingSec}s` : "—"} />
          <Row label="Stuck jobs (running > 15 min)" ok={h.queue.stuck === 0} value={String(h.queue.stuck)} />
          <Row label="Failed / dead jobs" ok={h.queue.dead === 0} value={`${h.queue.failed} failed · ${h.queue.dead} gave up`} />
        </ul>
      </section>
      <section className="rounded-[14px] border bg-surface shadow-card" aria-labelledby="h-config">
        <h2 id="h-config" className="border-b px-5 py-3 text-card-title">
          Configuration
        </h2>
        <ul className="divide-y">
          <Row label="Encryption key" ok={h.config.encryptionKey} value={yes(h.config.encryptionKey)} />
          <Row label="Anthropic" ok={null} value={yes(h.config.ai.anthropic)} />
          <Row label="OpenAI" ok={null} value={yes(h.config.ai.openai)} />
          <Row label="Google" ok={null} value={yes(h.config.ai.google)} />
          <Row label="Email delivery" ok={null} value={h.config.email === "console" ? "console (not delivered)" : h.config.email} />
          <Row label="File storage" ok={null} value={h.config.storage} />
          <Row label="App URL" ok={null} value={h.config.appUrl} />
          <Row label="Environment" ok={null} value={h.config.nodeEnv} />
        </ul>
      </section>
      <p className="text-xs text-text-muted">Secrets are never shown here — only whether they are set.</p>
    </div>
  );
}
