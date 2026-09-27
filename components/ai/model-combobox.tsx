"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProviderKind } from "@/lib/generated/prisma/enums";
import { OPENAI_STYLE_PRESETS } from "@/lib/ai/provider-presets";
import { listProviderModelsAction } from "@/app/(app)/settings/providers/actions";

interface ModelOption {
  id: string;
  label: string;
  free: boolean;
  tools: boolean | null;
}

/**
 * Model id input for free-form providers (OpenRouter, Groq, Ollama…). Suggestions
 * come live from the provider on first focus; any id can still be typed.
 */
export function ModelCombobox({
  provider,
  value,
  onChange,
  ariaLabel,
  className,
  disabled,
}: {
  provider: ProviderKind;
  value: string;
  onChange: (model: string) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const loadedFor = useRef<ProviderKind | null>(null);

  // A different provider means a different catalog.
  useEffect(() => {
    if (loadedFor.current && loadedFor.current !== provider) {
      loadedFor.current = null;
      setModels(null);
      setStatus("idle");
    }
  }, [provider]);

  async function load() {
    if (loadedFor.current === provider || status === "loading") return;
    loadedFor.current = provider;
    setStatus("loading");
    const res = await listProviderModelsAction(provider);
    if (res.ok) {
      setModels(res.data);
      setStatus("idle");
    } else {
      setError(res.error);
      setStatus("error");
      loadedFor.current = null; // allow a retry on the next focus
    }
  }

  const current = models?.find((m) => m.id === value);
  const freeCount = models?.filter((m) => m.free).length ?? 0;
  return (
    <div className={cn("grid gap-1", className)}>
      <div className="relative">
        <input
          className="h-10 w-full rounded-lg border border-input bg-transparent px-3 pr-8 text-sm disabled:opacity-60"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => void load()}
          list={listId}
          aria-label={ariaLabel}
          placeholder={OPENAI_STYLE_PRESETS[provider]?.modelPlaceholder ?? "model name"}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
        />
        {status === "loading" && <Loader2 className="absolute right-2.5 top-3 size-4 animate-spin text-text-muted" aria-label="Loading models" />}
        <datalist id={listId}>
          {models?.map((m) => (
            <option key={m.id} value={m.id}>
              {[m.free ? "Free" : null, m.tools === true ? "tools" : m.tools === false ? "no tools" : null, m.label !== m.id ? m.label : null].filter(Boolean).join(" · ")}
            </option>
          ))}
        </datalist>
      </div>
      <p className="text-xs text-text-muted" aria-live="polite">
        {status === "error"
          ? `Couldn't load models: ${error}`
          : current
            ? [current.free ? "Free model" : "Paid or unknown pricing", current.tools === false ? "can't use tools" : current.tools ? "supports tools" : null].filter(Boolean).join(" · ")
            : models
              ? `${models.length} models available${freeCount ? ` · ${freeCount} free (listed first)` : ""}`
              : "Click to see the provider's models, or type a model id."}
      </p>
    </div>
  );
}
