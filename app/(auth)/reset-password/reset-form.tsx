"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "../actions";
import { Field, FormError, SubmitButton } from "@/components/forms/field";
import { PASSWORD_MIN_LENGTH } from "@/lib/security/password-rules";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormError message={state && !state.ok && !errors?.password && !errors?.confirm ? state.error : undefined} />
      <input type="hidden" name="token" value={token} />
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        error={errors?.password}
        autoFocus
      />
      <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required error={errors?.confirm} />
      <SubmitButton pendingLabel="Updating…" className="w-full">
        Update password
      </SubmitButton>
    </form>
  );
}
