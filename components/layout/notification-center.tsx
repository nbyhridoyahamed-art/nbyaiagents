"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  listNotificationsAction,
  markNotificationsReadAction,
  type NotificationItem,
} from "@/app/(app)/shell-actions";
import { useShell } from "./shell-context";

export function NotificationCenter() {
  const { counts } = useShell();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [pending, start] = useTransition();
  const unread = items ? items.filter((i) => !i.read).length : counts.notifications;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) start(async () => setItems(await listNotificationsAction()));
  }

  function markAll() {
    start(async () => {
      await markNotificationsReadAction();
      setItems((prev) => prev?.map((i) => ({ ...i, read: true })) ?? null);
    });
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell className="size-[18px]" aria-hidden />
          {unread > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-danger ring-2 ring-surface" aria-hidden />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-card-title">Notifications</p>
          <Button variant="ghost" size="sm" onClick={markAll} disabled={pending || unread === 0}>
            <CheckCheck aria-hidden /> Mark all read
          </Button>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {items === null ? (
            <div className="flex items-center justify-center py-10 text-text-muted">
              <Loader2 className="size-4 animate-spin" aria-label="Loading notifications" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-text-muted">You&apos;re all caught up.</p>
          ) : (
            <ul>
              {items.map((n) => {
                const content = (
                  <>
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-brand")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-[13px]", n.read ? "text-text-secondary" : "font-medium text-foreground")}>
                        {n.title}
                        {!n.read && <span className="sr-only"> (unread)</span>}
                      </span>
                      {n.body && <span className="mt-0.5 block truncate text-xs text-text-muted">{n.body}</span>}
                      <span className="mt-0.5 block text-[11px] text-text-muted">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={n.id} className="border-b last:border-0">
                    {n.link ? (
                      <Link href={n.link} onClick={() => setOpen(false)} className="flex gap-3 px-4 py-3 hover:bg-surface-2">
                        {content}
                      </Link>
                    ) : (
                      <div className="flex gap-3 px-4 py-3">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
