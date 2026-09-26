"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Whole-dashboard failure (spec §99). Individual sections handle their own errors. */
export default function DashboardError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-danger-soft text-danger">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <h1 className="mt-5 text-section-title">We couldn&apos;t load your company dashboard.</h1>
      <p className="mt-2 text-text-secondary">Your data is safe.</p>
      <Button className="mt-6" onClick={() => retry()}>
        <RotateCw aria-hidden /> Try Again
      </Button>
    </div>
  );
}
