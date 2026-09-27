import { NextResponse } from "next/server";
import { userActor } from "@/lib/auth/actor";
import { env } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { isOAuthProvider } from "@/lib/integrations/oauth/providers";
import { decodeState } from "@/lib/integrations/oauth/state";
import { exchangeCodeForToken } from "@/lib/integrations/oauth/tokens";
import { finalizeOAuthConnection } from "@/server/services/integrations";

/**
 * GET /api/integrations/{provider}/callback — the provider redirects the
 * browser here after consent. `state` (signed in the authorize step) is the
 * only thing trusted to identify who started this — never the current session,
 * since the provider, not us, controls this navigation.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/integrations/[provider]/callback">) {
  const { provider } = await ctx.params;
  const back = (error?: string) => NextResponse.redirect(new URL(error ? `/integrations?error=${encodeURIComponent(error)}` : "/integrations?connected=1", request.url));

  if (!isOAuthProvider(provider)) return back("Unknown integration provider.");

  const url = new URL(request.url);
  const deniedOrError = url.searchParams.get("error");
  if (deniedOrError) return back(`${provider} sign-in was cancelled.`);

  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state");
  if (!code || !rawState) return back("Missing authorization response. Try connecting again.");

  try {
    const state = decodeState(rawState);
    if (state.provider !== provider) return back("This connection link doesn't match the provider. Try connecting again.");

    const redirectUri = `${env().APP_URL}/api/integrations/${provider}/callback`;
    const bundle = await exchangeCodeForToken(provider, code, redirectUri);
    await finalizeOAuthConnection(userActor(state.orgId, state.userId), provider, bundle);

    return back();
  } catch (err) {
    return back(isAppError(err) ? err.message : "Couldn't finish connecting. Please try again.");
  }
}
