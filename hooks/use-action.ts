"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/actions";

/**
 * Runs a server action from an event handler: shows a toast for the result,
 * exposes field errors and refreshes server components on success.
 */
export function useAction<Args extends unknown[], T>(
  action: (...args: Args) => Promise<ActionResult<T>>,
  opts: { success?: string | ((data: T) => string); refresh?: boolean; onSuccess?: (data: T) => void } = {},
) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const { success, refresh = true, onSuccess } = opts;

  const run = useCallback(
    (...args: Args) =>
      new Promise<ActionResult<T>>((resolve) => {
        start(async () => {
          setError(null);
          setFieldErrors({});
          const res = await action(...args);
          if (res.ok) {
            const msg = typeof success === "function" ? success(res.data) : (res.message ?? success);
            if (msg) toast.success(msg);
            onSuccess?.(res.data);
            if (refresh) router.refresh();
          } else {
            setError(res.error);
            setFieldErrors(res.fieldErrors ?? {});
            toast.error(res.error);
          }
          resolve(res);
        });
      }),
    [action, success, refresh, onSuccess, router],
  );

  return { run, pending, error, fieldErrors };
}
