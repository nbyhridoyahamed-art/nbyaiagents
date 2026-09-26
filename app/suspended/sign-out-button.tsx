"use client";

import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/app/(auth)/actions";

export function SignOutButton() {
  return (
    <Button variant="outline" onClick={() => void signOutAction()}>
      <LogOut aria-hidden /> Sign out
    </Button>
  );
}
