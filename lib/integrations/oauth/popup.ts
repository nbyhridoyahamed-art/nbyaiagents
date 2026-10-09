/**
 * How the sign-in popup reports back to the page that opened it.
 *
 * The app sends `Cross-Origin-Opener-Policy: same-origin`, which severs `window.opener` as soon as the popup
 * visits the provider's site, so the result travels over a same-origin BroadcastChannel instead (with a
 * localStorage event and postMessage as fallbacks for browsers that lack it).
 */
export const OAUTH_CHANNEL = "vdo-oauth";
export const OAUTH_STORAGE_KEY = "vdo-oauth-result";

export interface OAuthPopupResult {
  ok: boolean;
  /** Shown to the person as a toast. */
  message: string;
  provider: string;
  /** Epoch ms when the result was produced; lets the page ignore anything older than the sign-in it started. */
  at: number;
}

export function isOAuthPopupResult(value: unknown): value is OAuthPopupResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === "boolean" && typeof v.message === "string" && typeof v.provider === "string" && typeof v.at === "number";
}
