"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Inline, section-scoped error: one failing section never replaces the page. */
export function SectionError({ message = "This section is temporarily unavailable.", onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-danger/25 bg-danger-soft/60 p-4 sm:flex-row sm:items-center">
      <AlertTriangle className="size-5 shrink-0 text-danger" aria-hidden />
      <p className="flex-1 text-[13px] text-danger-text">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw aria-hidden /> Retry
        </Button>
      )}
    </div>
  );
}
