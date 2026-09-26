import { env } from "@/lib/env";

/**
 * Defense in depth for cookie-authenticated route handlers (server actions already
 * get Next's built-in origin check). The session cookie is SameSite=Lax, and this
 * additionally rejects state-changing requests sent from another site.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Browsers always send Origin on cross-site POSTs; a missing header means same-site or non-browser.
    return request.headers.get("sec-fetch-site") !== "cross-site";
  }
  try {
    const o = new URL(origin);
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (host && o.host === host) return true;
    return o.origin === new URL(env().APP_URL).origin;
  } catch {
    return false;
  }
}
