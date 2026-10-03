"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, CheckCircle2, FileText, Globe, Loader2, PenLine, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field } from "@/components/forms/field";
import { ConfirmButton } from "@/components/common/confirm-button";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import {
  addManualDocumentAction,
  addWebSourceAction,
  deleteCollectionAction,
  deleteDocumentAction,
  reindexDocumentAction,
  setCollectionAccessAction,
  updateCollectionAction,
} from "../actions";

interface Doc {
  id: string;
  title: string;
  sourceType: string;
  fileName: string | null;
  sourceUrl: string | null;
  status: "PENDING" | "PROCESSING" | "INDEXED" | "FAILED";
  error: string | null;
  chunkCount: number;
  pageCount: number | null;
  fileSize: number | null;
  embeddingModel: string | null;
  updatedAt: string;
}

const STATUS: Record<Doc["status"], { label: string; className: string }> = {
  PENDING: { label: "Queued", className: "bg-surface-2 text-text-secondary" },
  PROCESSING: { label: "Indexing…", className: "bg-info-soft text-info-text" },
  INDEXED: { label: "Indexed", className: "bg-success-soft text-success-text" },
  FAILED: { label: "Failed", className: "bg-danger-soft text-danger-text" },
};

export function CollectionView({
  collection,
  documents,
  access,
  agents,
  departments,
  canWrite,
  canManageAccess,
  externalSources,
}: {
  collection: { id: string; name: string; description: string; visibility: "RESTRICTED" | "ORGANIZATION" };
  documents: Doc[];
  access: { agentIds: string[]; departmentIds: string[] };
  agents: { id: string; name: string; jobTitle: string }[];
  departments: { id: string; name: string }[];
  canWrite: boolean;
  canManageAccess: boolean;
  externalSources: { key: string; name: string; availability: string }[];
}) {
  const router = useRouter();
  const busy = documents.some((d) => d.status === "PENDING" || d.status === "PROCESSING");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [busy, router]);

  const reindex = useAction(reindexDocumentAction, { success: "Re-indexing started." });
  const remove = useAction(deleteDocumentAction, { success: "Document deleted. Employees can no longer retrieve it." });

  return (
    <div className="grid content-start gap-6">
      {canWrite && <AddSources collectionId={collection.id} externalSources={externalSources} />}

      <section className="rounded-xl border bg-surface shadow-card" aria-labelledby="docs-title">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 id="docs-title" className="text-card-title">
            Documents <span className="font-normal text-text-muted">({documents.length})</span>
          </h2>
          {busy && (
            <span className="flex items-center gap-1.5 text-xs text-info-text">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Indexing in the background
            </span>
          )}
        </div>
        {documents.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-text-muted">No documents yet. Upload files, write a document, or add a website.</p>
        ) : (
          <ul className="divide-y">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-secondary">
                  {d.sourceType === "WEBSITE" ? <Globe className="size-4" aria-hidden /> : d.sourceType === "MANUAL" ? <PenLine className="size-4" aria-hidden /> : <FileText className="size-4" aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/knowledge/documents/${d.id}`} className="block truncate text-[13.5px] font-medium hover:underline">
                    {d.title}
                  </Link>
                  <p className="truncate text-xs text-text-muted">
                    {d.fileName ?? d.sourceUrl ?? "Written in Virtual Desks"}
                    {d.status === "INDEXED" && ` · ${d.chunkCount} chunks${d.pageCount ? ` · ${d.pageCount} pages` : ""}`} · {formatDistanceToNow(new Date(d.updatedAt), { addSuffix: true })}
                  </p>
                  {d.error && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-danger-text">
                      <AlertCircle className="size-3.5" aria-hidden /> {d.error}
                    </p>
                  )}
                </div>
                <Badge className={STATUS[d.status].className}>
                  {d.status === "INDEXED" && <CheckCircle2 aria-hidden />}
                  {d.status === "PROCESSING" && <Loader2 className="animate-spin" aria-hidden />}
                  {STATUS[d.status].label}
                </Badge>
                {canWrite && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => void reindex.run(d.id)} aria-label={`Re-index ${d.title}`} disabled={d.status === "PROCESSING"}>
                      <RefreshCw aria-hidden />
                    </Button>
                    <ConfirmButton
                      variant="ghost"
                      size="icon-sm"
                      destructive
                      title={`Delete “${d.title}”?`}
                      description="Its text is removed from the search index immediately, so no employee can retrieve it again."
                      confirmLabel="Delete"
                      onConfirm={() => remove.run(d.id)}
                    >
                      <Trash2 aria-hidden />
                      <span className="sr-only">Delete {d.title}</span>
                    </ConfirmButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <AccessSettings collection={collection} access={access} agents={agents} departments={departments} canManage={canManageAccess} canWrite={canWrite} />
    </div>
  );
}

function AddSources({ collectionId, externalSources }: { collectionId: string; externalSources: { key: string; name: string; availability: string }[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [manual, setManual] = useState({ title: "", content: "" });
  const [web, setWeb] = useState({ url: "", kind: "WEBSITE" as "WEBSITE" | "SITEMAP" });
  const addManual = useAction(addManualDocumentAction, { success: "Document saved. Indexing…", onSuccess: () => setManual({ title: "", content: "" }) });
  const addWeb = useAction(addWebSourceAction, { success: (d) => `Added ${d.pages} page${d.pages === 1 ? "" : "s"}. Indexing…`, onSuccess: () => setWeb({ ...web, url: "" }) });

  async function upload(files: FileList | File[]) {
    const list = [...files].slice(0, 5);
    if (!list.length) return;
    setUploading(true);
    const form = new FormData();
    list.forEach((f) => form.append("files", f));
    try {
      const res = await fetch(`/api/knowledge/${collectionId}/upload`, { method: "POST", body: form });
      const data = (await res.json()) as { results?: { name: string; ok: boolean; error?: string }[]; error?: string };
      if (!res.ok) toast.error(data.error ?? "Upload failed.");
      for (const r of data.results ?? []) {
        if (r.ok) toast.success(`${r.name} uploaded. Indexing…`);
        else toast.error(`${r.name}: ${r.error}`);
      }
    } catch {
      toast.error("Upload failed. Check your connection.");
    } finally {
      setUploading(false);
      router.refresh();
    }
  }

  return (
    <section className="rounded-xl border bg-surface p-5 shadow-card">
      <h2 className="text-card-title">Add knowledge</h2>
      <Tabs defaultValue="upload" className="mt-3">
        <TabsList>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="write">Write</TabsTrigger>
          <TabsTrigger value="web">Website</TabsTrigger>
          <TabsTrigger value="connect">Connected sources</TabsTrigger>
        </TabsList>
        <TabsContent value="upload" className="mt-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void upload(e.dataTransfer.files);
            }}
            className={cn(
              "flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
              drag ? "border-brand bg-brand-soft" : "hover:bg-surface-2",
            )}
            disabled={uploading}
          >
            {uploading ? <Loader2 className="size-6 animate-spin text-brand" aria-hidden /> : <Upload className="size-6 text-text-muted" aria-hidden />}
            <span className="mt-2 text-[13.5px] font-medium">{uploading ? "Uploading…" : "Drop files here or click to browse"}</span>
            <span className="text-xs text-text-muted">PDF, DOCX, XLSX, CSV, Markdown or TXT · up to 20 MB each · 5 at a time</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.xlsx,.csv,.md,.markdown,.txt"
            className="sr-only"
            onChange={(e) => {
              if (e.target.files) void upload(e.target.files);
              e.target.value = "";
            }}
            aria-label="Choose files to upload"
          />
        </TabsContent>
        <TabsContent value="write" className="mt-4">
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void addManual.run({ knowledgeBaseId: collectionId, ...manual });
            }}
          >
            <Field label="Title" name="title" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} error={addManual.fieldErrors.title} placeholder="Refund Policy" />
            <Field label="Content" name="content" multiline rows={8} defaultValue={manual.content} key={manual.content === "" ? "empty" : "filled"} onChange={(e) => setManual({ ...manual, content: e.target.value })} error={addManual.fieldErrors.content} placeholder="Markdown is supported. Use headings (## Section) to help retrieval." />
            <Button type="submit" className="justify-self-end" disabled={addManual.pending}>
              {addManual.pending && <Loader2 className="animate-spin" aria-hidden />} Save document
            </Button>
          </form>
        </TabsContent>
        <TabsContent value="web" className="mt-4">
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void addWeb.run({ knowledgeBaseId: collectionId, ...web });
            }}
          >
            <Field label="URL" name="url" type="url" value={web.url} onChange={(e) => setWeb({ ...web, url: e.target.value })} error={addWeb.fieldErrors.url} placeholder="https://example.com/faq" />
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={web.kind === "SITEMAP"} onCheckedChange={(c) => setWeb({ ...web, kind: c ? "SITEMAP" : "WEBSITE" })} />
              This is a sitemap.xml — import up to 25 pages from it
            </label>
            <p className="text-xs text-text-muted">Pages are fetched server-side with private-network protection. Web content is treated as untrusted reference material.</p>
            <Button type="submit" className="justify-self-end" disabled={addWeb.pending || !web.url}>
              {addWeb.pending && <Loader2 className="animate-spin" aria-hidden />} Add
            </Button>
          </form>
        </TabsContent>
        <TabsContent value="connect" className="mt-4">
          <ul className="grid gap-2 sm:grid-cols-2">
            {[...externalSources, { key: "onedrive", name: "OneDrive", availability: "coming_soon" }].map((s) => (
              <li key={s.key} className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-[13.5px] font-medium">{s.name}</span>
                <Badge variant="secondary">{s.availability === "requires_setup" ? "Not configured" : "Coming soon"}</Badge>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-muted">Sync connectors are part of the integration architecture and become available once configured by the platform operator.</p>
        </TabsContent>
      </Tabs>
    </section>
  );
}

function AccessSettings({
  collection,
  access,
  agents,
  departments,
  canManage,
  canWrite,
}: {
  collection: { id: string; name: string; description: string; visibility: "RESTRICTED" | "ORGANIZATION" };
  access: { agentIds: string[]; departmentIds: string[] };
  agents: { id: string; name: string; jobTitle: string }[];
  departments: { id: string; name: string }[];
  canManage: boolean;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [agentIds, setAgentIds] = useState(access.agentIds);
  const [departmentIds, setDepartmentIds] = useState(access.departmentIds);
  const saveAccess = useAction(setCollectionAccessAction, { success: "Access updated." });
  const updateVisibility = useAction(updateCollectionAction, { success: "Visibility updated." });
  const del = useAction(deleteCollectionAction, { refresh: false, success: "Collection deleted.", onSuccess: () => router.push("/knowledge") });
  const toggle = (list: string[], set: (v: string[]) => void, id: string, on: boolean) => set(on ? [...list, id] : list.filter((x) => x !== id));

  return (
    <section className="rounded-xl border bg-surface p-5 shadow-card" aria-labelledby="access-title">
      <h2 id="access-title" className="text-card-title">
        Access
      </h2>
      <p className="text-[13px] text-text-secondary">Knowledge isn&apos;t shared with every employee automatically. Retrieval is filtered by these rules.</p>
      <label className="mt-4 flex items-center gap-2 text-[13.5px]">
        <Checkbox
          checked={collection.visibility === "ORGANIZATION"}
          disabled={!canManage || updateVisibility.pending}
          onCheckedChange={(c) => void updateVisibility.run({ id: collection.id, visibility: c ? "ORGANIZATION" : "RESTRICTED" })}
        />
        Every AI employee can read this collection
      </label>
      {collection.visibility === "RESTRICTED" && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Employees</legend>
            <div className="grid gap-1.5">
              {agents.length === 0 && <p className="text-xs text-text-muted">No employees yet.</p>}
              {agents.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-[13px]">
                  <Checkbox checked={agentIds.includes(a.id)} disabled={!canManage} onCheckedChange={(c) => toggle(agentIds, setAgentIds, a.id, !!c)} />
                  {a.name} <span className="text-text-muted">· {a.jobTitle}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Departments</legend>
            <div className="grid gap-1.5">
              {departments.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-[13px]">
                  <Checkbox checked={departmentIds.includes(d.id)} disabled={!canManage} onCheckedChange={(c) => toggle(departmentIds, setDepartmentIds, d.id, !!c)} />
                  {d.name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
      {canManage && (
        <div className="mt-5 flex flex-wrap justify-between gap-2 border-t pt-4">
          {canWrite && (
            <ConfirmButton size="sm" variant="ghost" destructive title={`Delete ${collection.name}?`} description="All documents in it are removed from search immediately." confirmLabel="Delete collection" onConfirm={() => del.run(collection.id)}>
              Delete collection
            </ConfirmButton>
          )}
          {collection.visibility === "RESTRICTED" && (
            <Button size="sm" disabled={saveAccess.pending} onClick={() => void saveAccess.run({ id: collection.id, agentIds, departmentIds })}>
              {saveAccess.pending && <Loader2 className="animate-spin" aria-hidden />} Save access
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
