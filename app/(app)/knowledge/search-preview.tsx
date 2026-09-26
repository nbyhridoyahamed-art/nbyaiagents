"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { searchPreviewAction, type SearchPreviewHit } from "./actions";

/** Lets the owner test retrieval: what would an employee find for this question? */
export function SearchPreview({ knowledgeBaseIds, autoFocus }: { knowledgeBaseIds?: string[]; autoFocus?: boolean }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchPreviewHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="h-fit rounded-xl border bg-surface p-5 shadow-card" aria-labelledby="search-preview">
      <h2 id="search-preview" className="text-card-title">
        Test search
      </h2>
      <p className="text-[13px] text-text-secondary">See which passages an employee would retrieve for a question.</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const res = await searchPreviewAction({ query, knowledgeBaseIds });
            if (res.ok) setHits(res.data);
            else setError(res.error);
          });
        }}
      >
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What is our refund policy?" className="h-9" aria-label="Search question" autoFocus={autoFocus} />
        <Button type="submit" size="icon" disabled={pending || query.trim().length < 2} aria-label="Search">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />}
        </Button>
      </form>
      {error && <p className="mt-2 text-xs text-danger-text">{error}</p>}
      {hits && (
        <ul className="mt-4 grid gap-2">
          {hits.length === 0 && <li className="text-[13px] text-text-muted">No relevant passages found.</li>}
          {hits.map((h, i) => (
            <li key={`${h.documentId}-${i}`} className="rounded-lg border p-3">
              <Link href={`/knowledge/documents/${h.documentId}${h.page ? `?page=${h.page}` : ""}`} className="text-[13px] font-medium text-brand hover:underline">
                {h.title}
                {h.page ? ` · p.${h.page}` : ""}
              </Link>
              <p className="text-[11px] text-text-muted">
                {h.collection} · relevance {h.score}
              </p>
              <p className="mt-1 line-clamp-4 text-xs text-text-secondary">{h.excerpt}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
