"use client";

import { useCallback, useSyncExternalStore } from "react";

const LOCAL_EVENT = "vdo-local-storage";
const noopSubscribe = () => () => {};

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** A localStorage-backed value that is hydration-safe (server renders `fallback`). */
export function useLocalStorage(key: string, fallback: string): [string, (value: string) => void] {
  const subscribe = useCallback((cb: () => void) => {
    const onStorage = (e: Event) => {
      if (e instanceof StorageEvent ? e.key === key : (e as CustomEvent<string>).detail === key) cb();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(LOCAL_EVENT, onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(LOCAL_EVENT, onStorage);
    };
  }, [key]);
  const value = useSyncExternalStore(
    subscribe,
    () => readStorage(key) ?? fallback,
    () => fallback,
  );
  const set = useCallback(
    (next: string) => {
      try {
        localStorage.setItem(key, next);
      } catch {
        /* storage unavailable — value simply won't persist */
      }
      window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: key }));
    },
    [key],
  );
  return [value, set];
}

/** The browser's IANA timezone (server snapshot: "UTC"). */
export function useBrowserTimezone(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    () => "UTC",
  );
}
