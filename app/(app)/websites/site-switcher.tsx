"use client";

import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL = "__all";

/** Jump between websites without leaving the tab you are on. */
export function SiteSwitcher({ sites, currentId, tab }: { sites: { id: string; label: string }[]; currentId: string; tab: string }) {
  const router = useRouter();
  return (
    <Select
      value={currentId}
      onValueChange={(id) => {
        if (id === ALL) router.push("/websites");
        else router.push(`/websites/${id}${tab === "overview" ? "" : `?tab=${tab}`}`);
      }}
    >
      <SelectTrigger className="h-10 w-full min-w-[14rem] sm:w-64" aria-label="Switch website">
        <Globe aria-hidden className="text-text-muted" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {sites.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.label}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={ALL}>All websites…</SelectItem>
      </SelectContent>
    </Select>
  );
}
