"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { linkAnalyticsAction, linkSearchConsoleAction } from "./actions";

export interface PickerOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

const COPY = {
  analytics: {
    title: "Which Analytics property is this site?",
    many: "Your Google account has more than one property. Choose the one that measures this website.",
    one: "Choose the property that measures this website.",
    none: "The connected Google account doesn't have any Analytics properties to choose from.",
    placeholder: "Choose a property",
    saved: "Analytics linked.",
  },
  "search-console": {
    title: "Which Search Console property is this site?",
    many: "Choose the property that should measure this website.",
    one: "Choose the property that should measure this website.",
    none: "The connected Google account doesn't have any Search Console properties to choose from.",
    placeholder: "Choose a property",
    saved: "Search Console linked.",
  },
} as const;

/** One Google property per website, chosen once. Mirrors Search Console's "which property is this site?" step. */
export function PropertyPicker({
  kind,
  websiteId,
  options,
  initial,
  doneHref,
  cancelHref,
}: {
  kind: keyof typeof COPY;
  websiteId: string;
  options: PickerOption[];
  /** Pre-selected value: the current link, otherwise the best match. */
  initial: string | null;
  /** Where to go once saved. */
  doneHref: string;
  /** Shown when changing an existing link, so the person can back out. */
  cancelHref?: string;
}) {
  const router = useRouter();
  const copy = COPY[kind];
  const [value, setValue] = useState(initial ?? "");
  const save = useAction(
    (chosen: string) => (kind === "analytics" ? linkAnalyticsAction({ id: websiteId, property: chosen }) : linkSearchConsoleAction({ id: websiteId, siteUrl: chosen })),
    { success: copy.saved, refresh: false, onSuccess: () => router.push(doneHref) },
  );

  // Keep the order the server ranked them in, grouped by their label.
  const groups = new Map<string, PickerOption[]>();
  for (const option of options) groups.set(option.group ?? "", [...(groups.get(option.group ?? "") ?? []), option]);

  return (
    <section className="rounded-[14px] border bg-surface p-5 shadow-card">
      <h2 className="text-card-title">{copy.title}</h2>
      <p className="mt-1 text-[13px] text-text-secondary">{options.length > 1 ? copy.many : options.length === 1 ? copy.one : copy.none}</p>
      {options.length > 0 && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger className="h-10 w-full sm:max-w-xl" aria-label={copy.title}>
              <SelectValue placeholder={copy.placeholder} />
            </SelectTrigger>
            <SelectContent>
              {[...groups.entries()].map(([group, items]) => (
                <SelectGroup key={group || "_"}>
                  {group && <SelectLabel>{group}</SelectLabel>}
                  {items.map((o) => (
                    <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button onClick={() => void save.run(value)} disabled={!value || save.pending}>
              {save.pending && <Loader2 className="animate-spin" aria-hidden />} Use this property
            </Button>
            {cancelHref && (
              <Button asChild variant="outline">
                <Link href={cancelHref}>Cancel</Link>
              </Button>
            )}
          </div>
        </div>
      )}
      {options.length === 0 && cancelHref && (
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href={cancelHref}>Back</Link>
        </Button>
      )}
      {save.error && (
        <p role="alert" className="mt-3 text-[13px] text-danger-text">
          {save.error}
        </p>
      )}
    </section>
  );
}
