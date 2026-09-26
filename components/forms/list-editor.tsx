"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Editable list of short text items (responsibilities, goals, KPIs). */
export function ListEditor({
  label,
  items,
  onChange,
  placeholder,
  max = 20,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  max?: number;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || items.length >= max) return;
    onChange([...items, v.slice(0, 300)]);
    setDraft("");
  };
  return (
    <div className="grid gap-2">
      <span className="text-[13px] font-medium">{label}</span>
      {items.length > 0 && (
        <ul className="grid gap-1.5">
          {items.map((item, i) => (
            <li key={`${i}-${item}`} className="flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-[13px]">
              <span className="flex-1">{item}</span>
              <button
                type="button"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                className="rounded p-0.5 text-text-muted hover:bg-surface-2 hover:text-foreground"
                aria-label={`Remove ${item}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="h-9"
          aria-label={`Add to ${label}`}
          disabled={items.length >= max}
        />
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={add} disabled={!draft.trim() || items.length >= max}>
          <Plus aria-hidden /> Add
        </Button>
      </div>
    </div>
  );
}
