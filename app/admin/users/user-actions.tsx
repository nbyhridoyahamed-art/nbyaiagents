"use client";

import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAction } from "@/hooks/use-action";
import { setUserDisabledAction, setUserRoleAction } from "../actions";

export function UserActions({ user }: { user: { id: string; email: string; disabled: boolean; admin: boolean } }) {
  const disable = useAction(setUserDisabledAction, { success: user.disabled ? "User enabled." : "User disabled and signed out everywhere." });
  const role = useAction(setUserRoleAction, { success: "Platform role updated." });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${user.email}`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void role.run({ userId: user.id, role: user.admin ? "USER" : "SUPER_ADMIN" })}>{user.admin ? "Remove platform admin" : "Make platform admin"}</DropdownMenuItem>
        <DropdownMenuItem variant={user.disabled ? "default" : "destructive"} onSelect={() => void disable.run({ userId: user.id, disabled: !user.disabled })}>
          {user.disabled ? "Enable account" : "Disable account"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
