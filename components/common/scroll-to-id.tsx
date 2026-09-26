"use client";

import { useEffect } from "react";

/** Scrolls an element into view after mount (works on client-side navigation too). */
export function ScrollToId({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [id]);
  return null;
}
