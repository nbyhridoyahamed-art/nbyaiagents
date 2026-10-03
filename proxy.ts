import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic auth gate: bounces requests without a session cookie away from app
 * pages early. Real authorization happens server-side in every page, action and
 * route handler (see lib/auth/context.ts) — this is only a UX shortcut.
 */
const PUBLIC_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email", "/invite", "/api"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic && !request.cookies.has("vdo_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)"],
};
