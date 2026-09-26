import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <Compass className="size-6" aria-hidden />
      </span>
      <h1 className="mt-5 text-section-title">We can&apos;t find that page.</h1>
      <p className="mt-2 text-text-secondary">It may have been moved or deleted, or you might not have access to it.</p>
      <Button asChild className="mt-6">
        <Link href="/dashboard">Go to the dashboard</Link>
      </Button>
    </main>
  );
}
