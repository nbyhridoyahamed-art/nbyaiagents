"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/field";
import { useAction } from "@/hooks/use-action";
import { changePasswordAction, updateProfileAction } from "../actions";

export function ProfileForms({ name: initialName, email, verified }: { name: string; email: string; verified: boolean }) {
  const [name, setName] = useState(initialName);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const profile = useAction(updateProfileAction, { success: "Profile updated." });
  const password = useAction(changePasswordAction, {
    success: "Password changed. Other devices were signed out.",
    onSuccess: () => setPw({ current: "", next: "", confirm: "" }),
  });

  return (
    <div className="grid gap-6">
      <form
        className="rounded-xl border bg-surface p-5 shadow-card sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void profile.run({ name });
        }}
      >
        <h2 className="text-card-title">Profile</h2>
        <div className="mt-4 grid gap-4">
          <Field label="Name" name="name" value={name} onChange={(e) => setName(e.target.value)} error={profile.fieldErrors.name} />
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Email</span>
            <div className="flex items-center gap-2 text-[13.5px]">
              {email}
              {verified ? <Badge className="bg-success-soft text-success-text">Verified</Badge> : <Badge variant="secondary">Not verified</Badge>}
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button type="submit" disabled={profile.pending}>
            {profile.pending && <Loader2 className="animate-spin" aria-hidden />}
            Save
          </Button>
        </div>
      </form>

      <form
        className="rounded-xl border bg-surface p-5 shadow-card sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void password.run(pw);
        }}
      >
        <h2 className="text-card-title">Change password</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Current password" name="current" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} error={password.fieldErrors.current} />
          <Field label="New password" name="next" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} error={password.fieldErrors.next} />
          <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} error={password.fieldErrors.confirm} />
        </div>
        <div className="mt-5 flex justify-end">
          <Button type="submit" disabled={password.pending}>
            {password.pending && <Loader2 className="animate-spin" aria-hidden />}
            Change password
          </Button>
        </div>
      </form>
    </div>
  );
}
