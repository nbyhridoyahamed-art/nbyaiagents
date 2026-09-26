"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { clearSessionCookie, getSession, requestMeta, setSessionCookie, SESSION_COOKIE } from "@/lib/auth/context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  createSession,
  requestPasswordReset,
  resetPassword,
  revokeSession,
  signIn,
  signUp,
} from "@/server/services/auth";
import { cookies } from "next/headers";
import { writeAudit } from "@/server/services/audit";

const email = z.string().trim().email("Enter a valid email address.").max(254);

/** Only allow same-site relative redirects after login (prevents open redirects). */
function safeNext(next: unknown) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  email,
  password: z.string().min(1, "Choose a password."),
  next: z.string().optional(),
});

export async function signUpAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const meta = await requestMeta();
  let next = "/onboarding";
  const result = await runAction(signUpSchema, Object.fromEntries(formData), async (data) => {
    await enforceRateLimit("authSignup", meta.ip ?? "unknown");
    const user = await signUp(data);
    const { token } = await createSession(user.id, meta);
    await setSessionCookie(token);
    // Invitation links bring new users straight back to the invite.
    if (data.next?.startsWith("/invite/")) next = safeNext(data.next);
  });
  if (!result.ok) return result;
  redirect(next);
}

const signInSchema = z.object({ email, password: z.string().min(1, "Enter your password."), next: z.string().optional() });

export async function signInAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const meta = await requestMeta();
  let next = "/dashboard";
  const result = await runAction(signInSchema, Object.fromEntries(formData), async (data) => {
    await enforceRateLimit("authLogin", `${meta.ip ?? "unknown"}:${data.email.toLowerCase()}`);
    await enforceRateLimit("authLoginAccount", data.email.toLowerCase());
    const user = await signIn(data);
    const { token } = await createSession(user.id, meta);
    await setSessionCookie(token);
    next = safeNext(data.next);
  });
  if (!result.ok) return result;
  redirect(next);
}

export async function signOutAction() {
  const session = await getSession();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  if (session) await writeAudit({ actorType: "USER", actorUserId: session.userId, action: "auth.logout" });
  await clearSessionCookie();
  redirect("/login");
}

export async function forgotPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const meta = await requestMeta();
  return runAction(z.object({ email }), Object.fromEntries(formData), async (data) => {
    await enforceRateLimit("authReset", meta.ip ?? "unknown");
    await requestPasswordReset(data.email);
    return undefined;
  });
}

const resetSchema = z
  .object({ token: z.string().min(10), password: z.string().min(1, "Choose a password."), confirm: z.string() })
  .refine((d) => d.password === d.confirm, { message: "Passwords don't match.", path: ["confirm"] });

export async function resetPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await runAction(resetSchema, Object.fromEntries(formData), async (data) => {
    await resetPassword(data.token, data.password);
  });
  if (!result.ok) return result;
  redirect("/login?reset=1");
}
