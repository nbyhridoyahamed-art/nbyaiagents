"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FieldProps extends React.ComponentProps<"input"> {
  label: string;
  name: string;
  hint?: React.ReactNode;
  error?: string;
  multiline?: boolean;
  rows?: number;
}

/** Labelled input with accessible error/hint wiring. */
export function Field({ label, name, hint, error, multiline, rows = 4, className, id, ...props }: FieldProps) {
  const inputId = id ?? `field-${name}`;
  const describedBy = [error ? `${inputId}-error` : null, hint ? `${inputId}-hint` : null].filter(Boolean).join(" ") || undefined;
  const shared = {
    id: inputId,
    name,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  };
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={inputId} className="text-[13px] font-medium text-foreground">
        {label}
      </Label>
      {multiline ? (
        <Textarea
          {...shared}
          rows={rows}
          defaultValue={props.defaultValue as string | undefined}
          placeholder={props.placeholder}
          required={props.required}
          disabled={props.disabled}
          maxLength={props.maxLength}
          autoFocus={props.autoFocus}
          readOnly={props.readOnly}
          // The handlers are typed for <input>; a textarea raises the same events. Dropping them (as this used to)
          // left every multiline field in the app unable to report what was typed.
          onChange={props.onChange as unknown as React.ChangeEventHandler<HTMLTextAreaElement> | undefined}
          onBlur={props.onBlur as unknown as React.FocusEventHandler<HTMLTextAreaElement> | undefined}
        />
      ) : (
        <Input {...shared} {...props} className="h-10" />
      )}
      {hint && !error && (
        <p id={`${inputId}-hint`} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${inputId}-error`} className="text-xs font-medium text-danger-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending || props.disabled} className={className} {...props}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px] text-danger-text">
      {message}
    </div>
  );
}

export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="status" className="rounded-lg border border-success/30 bg-success-soft px-3 py-2.5 text-[13px] text-success-text">
      {message}
    </div>
  );
}
