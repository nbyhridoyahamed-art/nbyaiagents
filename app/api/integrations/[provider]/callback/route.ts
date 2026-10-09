import { NextResponse } from "next/server";
import { userActor } from "@/lib/auth/actor";
import { env } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { popupResultResponse } from "@/lib/integrations/oauth/popup-response";
import { OAUTH_PROVIDERS, isOAuthProvider } from "@/lib/integrations/oauth/providers";
import { decodeState, tryDecodeState } from "@/lib/integrations/oauth/state";
import { exchangeCodeForToken } from "@/lib/integrations/oauth/tokens";
import { appUrl } from "@/lib/url";
import { finalizeOAuthConnection } from "@/server/services/integrations";

/**
 * GET /api/integrations/{provider}/callback — the provider redirects the
 * browser here after consent. `state` (signed in the authorize step) is the
 * only thing trusted to identify who started this — never the current session,
 * since the provider, not us, controls this navigation.
 *
 * If the sign-in ran in a popup (recorded in `state`), the answer is the popup's result page instead of a
 * redirect: it tells the Integrations page how it went and closes the window.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/integrations/[provider]/callback">) {
  const { provider } = await ctx.params;
  const url = new URL(request.url);
  const rawState = url.searchParams.get("state");
  const popup = tryDecodeState(rawState)?.popup === true;
  const label = isOAuthProvider(provider) ? OAUTH_PROVIDERS[provider].label : "This integration";

  const finish = (error?: string) => {
    if (popup) return popupResultResponse({ ok: !error, message: error ?? `${label} connected.`, provider });
    return NextResponse.redirect(appUrl(error ? `/integrations?error=${encodeURIComponent(error)}` : "/integrations?connected=1"));
  };

  if (!isOAuthProvider(provider)) return finish("Unknown integration provider.");
  if (url.searchParams.get("error")) return finish(`${label} sign-in was cancelled.`);

  const code = url.searchParams.get("code");
  if (!code || !rawState) return finish("Missing authorization response. Try connecting again.");

  try {
    const state = decodeState(rawState);
    if (state.provider !== provider) return finish("This connection link doesn't match the provider. Try connecting again.");

    const redirectUri = `${env().APP_URL}/api/integrations/${provider}/callback`;
    const bundle = await exchangeCodeForToken(provider, code, redirectUri);
    await finalizeOAuthConnection(userActor(state.orgId, state.userId), provider, bundle);

    return finish();
  } catch (err) {
    return finish(isAppError(err) ? err.message : "Couldn't finish connecting. Please try again.");
  }
}
