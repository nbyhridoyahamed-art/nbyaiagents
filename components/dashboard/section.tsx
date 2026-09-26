"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { SectionError } from "@/components/common/section-error";

/** Section-scoped failure with a Retry that re-renders just the server data (spec §99). */
export function SectionFailed({ label }: { label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <SectionError message={pending ? "Retrying…" : `${label} temporarily unavailable.`} onRetry={() => start(() => router.refresh())} />;
}
