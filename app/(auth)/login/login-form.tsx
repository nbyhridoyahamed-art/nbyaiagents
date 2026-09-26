"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction } from "../actions";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/forms/field";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action] = useActionState(signInAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const formError = state && !state.ok && !errors?.email && !errors?.password ? state.error : undefined;
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormSuccess message={state ? undefined : notice} />
      <FormError message={formError} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Work email" name="email" type="email" autoComplete="email" required error={errors?.email} autoFocus />
      <div className="grid gap-1.5">
        <Field label="Password" name="password" type="password" autoComplete="current-password" required error={errors?.password} />
        <Link href="/forgot-password" className="justify-self-end text-xs font-medium text-brand hover:underline">
          Forgot password?
        </Link>
      </div>
      <SubmitButton pendingLabel="Signing in…" className="mt-1 w-full">
        Sign in
      </SubmitButton>
    </form>
  );
}
