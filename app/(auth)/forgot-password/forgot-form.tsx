"use client";

import { useActionState } from "react";
import { forgotPasswordAction } from "../actions";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/forms/field";

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, null);
  if (state?.ok) {
    return (
      <FormSuccess message="If an account exists for that email, a reset link is on its way. The link expires in 1 hour." />
    );
  }
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormError message={state && !state.ok && !errors ? state.error : undefined} />
      <Field label="Work email" name="email" type="email" autoComplete="email" required error={errors?.email} autoFocus />
      <SubmitButton pendingLabel="Sending…" className="w-full">
        Send reset link
      </SubmitButton>
    </form>
  );
}
