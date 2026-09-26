"use client";

import "./globals.css";

/** Last-resort boundary when the root layout itself fails. Must render its own <html>/<body>. */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-background px-4 text-center text-foreground">
        <div className="max-w-md">
          <h1 className="text-section-title">NBY AI Agents couldn&apos;t load.</h1>
          <p className="mt-2 text-text-secondary">Your data is safe. Please try again in a moment.</p>
          <button type="button" onClick={() => retry()} className="mt-6 rounded-lg bg-brand px-4 py-2 text-[14px] font-semibold text-white">
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
