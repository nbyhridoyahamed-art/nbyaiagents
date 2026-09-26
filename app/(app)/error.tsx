"use client";

import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** In-app error boundary: the navigation stays usable and nothing is lost. */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-danger-soft text-danger">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <h1 className="mt-5 text-section-title">This page couldn&apos;t load.</h1>
      <p className="mt-2 text-text-secondary">Your data is safe. Try again, or go back to the dashboard.</p>
      {error.digest && <p className="mt-2 font-mono text-[11px] text-text-muted">Reference: {error.digest}</p>}
      <div className="mt-6 flex gap-2">
        <Button onClick={() => retry()}>
          <RotateCw aria-hidden /> Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
