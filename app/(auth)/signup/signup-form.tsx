"use client";

import { useActionState } from "react";
import { signUpAction } from "../actions";
import { Field, FormError, SubmitButton } from "@/components/forms/field";
import { PASSWORD_MIN_LENGTH } from "@/lib/security/password-rules";

export function SignUpForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signUpAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const formError = state && !state.ok && !errors ? state.error : undefined;
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormError message={formError} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Your name" name="name" autoComplete="name" required error={errors?.name} autoFocus />
      <Field label="Work email" name="email" type="email" autoComplete="email" required error={errors?.email} />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters, with letters and numbers or symbols.`}
        error={errors?.password}
      />
      <SubmitButton pendingLabel="Creating account…" className="mt-1 w-full">
        Create account
      </SubmitButton>
      <p className="text-center text-xs text-text-muted">
        You&apos;ll set up your company workspace next.
      </p>
    </form>
  );
}
