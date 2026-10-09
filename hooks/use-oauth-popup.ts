"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { OAUTH_CHANNEL, OAUTH_STORAGE_KEY, isOAuthPopupResult } from "@/lib/integrations/oauth/popup";

// The signed link behind a sign-in is only valid for ten minutes, so there is no point waiting longer.
const WAIT_LIMIT_MS = 10 * 60 * 1000;

function openSignInWindow(url: string): Window | null {
  const width = 520;
  const height = 720;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  return window.open(url, "vdo-oauth", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
}

export interface OAuthPopup {
  /** Provider whose sign-in window is open right now, if any. */
  waiting: string | null;
  start: (provider: string) => void;
  /** Stop waiting (the window itself is the person's to close). */
  cancel: () => void;
}

/**
 * Connects an integration through the provider's own sign-in page in a small window,
 * so the person never leaves the Integrations page. If the browser blocks the window, the same
 * sign-in runs in this tab instead.
 */
export function useOAuthPopup(): OAuthPopup {
  const router = useRouter();
  const [waiting, setWaiting] = useState<string | null>(null);
  const startedAt = useRef(0);

  // Only listen while a sign-in window is open.
  useEffect(() => {
    if (!waiting) return;

    const onResult = (data: unknown) => {
      // Ignore anything produced before this sign-in began (a stale localStorage value, another tab's result).
      if (!isOAuthPopupResult(data) || data.at < startedAt.current - 5_000) return;
      setWaiting(null);
      if (data.ok) {
        toast.success(data.message, data.provider === "google" ? { action: { label: "Set up websites", onClick: () => router.push("/websites") } } : undefined);
        router.refresh();
      } else {
        toast.error(data.message);
      }
    };

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(OAUTH_CHANNEL);
      channel.onmessage = (event) => onResult(event.data);
    } catch {
      // No BroadcastChannel in this browser: the storage and message listeners below still work.
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== OAUTH_STORAGE_KEY || !event.newValue) return;
      try {
        onResult(JSON.parse(event.newValue));
      } catch {
        // Not ours.
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin) onResult(event.data);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => setWaiting(null), WAIT_LIMIT_MS);

    return () => {
      channel?.close();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, [waiting, router]);

  const start = useCallback((provider: string) => {
    startedAt.current = Date.now();
    const signIn = openSignInWindow(`/api/integrations/${provider}/authorize?popup=1`);
    if (!signIn) {
      // Blocked: run the same sign-in in this tab. It's a route handler that redirects to the provider, so it needs a real navigation.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/api/integrations/${provider}/authorize`);
      return;
    }
    setWaiting(provider);
  }, []);

  const cancel = useCallback(() => setWaiting(null), []);

  return { waiting, start, cancel };
}
