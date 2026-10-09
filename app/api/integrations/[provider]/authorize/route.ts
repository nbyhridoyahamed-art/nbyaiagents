import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth/context";
import { env } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { isIntegrationConfigured } from "@/lib/integrations/catalog";
import { popupResultResponse } from "@/lib/integrations/oauth/popup-response";
import { OAUTH_PROVIDERS, PROVIDER_INTEGRATION_KEYS, isOAuthProvider } from "@/lib/integrations/oauth/providers";
import { encodeState } from "@/lib/integrations/oauth/state";
import { appUrl } from "@/lib/url";

/**
 * GET /api/integrations/{provider}/authorize — starts the OAuth consent flow.
 * A real page navigation (clicked from /integrations), not a fetch/server action:
 * on any problem this redirects back rather than rendering a raw error.
 *
 * With `?popup=1` the flow runs in a small sign-in window: problems are shown on the popup's
 * result page, which also tells the Integrations page how it went (see lib/integrations/oauth/popup.ts).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/integrations/[provider]/authorize">) {
  const { provider } = await ctx.params;
  const popup = new URL(request.url).searchParams.get("popup") === "1";
  const back = (error: string) =>
    popup ? popupResultResponse({ ok: false, message: error, provider }) : NextResponse.redirect(appUrl(`/integrations?error=${encodeURIComponent(error)}`));

  if (!isOAuthProvider(provider)) return back("Unknown integration provider.");
  const config = OAUTH_PROVIDERS[provider];

  try {
    const orgCtx = await requireOrgContext("tools:manage");
    const representativeKey = PROVIDER_INTEGRATION_KEYS[provider][0];
    if (!representativeKey || !isIntegrationConfigured(representativeKey)) {
      return back(`${config.label} isn't configured on this platform yet.`);
    }

    const clientId = env()[config.clientIdEnv];
    const state = encodeState({ orgId: orgCtx.org.id, userId: orgCtx.user.id, provider, ...(popup ? { popup: true } : {}) });
    const url = new URL(config.authorizeUrl);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", `${env().APP_URL}/api/integrations/${provider}/callback`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.scopes.join(" "));
    url.searchParams.set("state", state);
    for (const [key, value] of Object.entries(config.extraAuthorizeParams ?? {})) url.searchParams.set(key, value);

    return NextResponse.redirect(url);
  } catch (err) {
    if (isAppError(err) && err.code === "UNAUTHENTICATED") {
      return popup ? back("Your session has ended. Sign in again, then try connecting.") : NextResponse.redirect(appUrl("/login?next=%2Fintegrations"));
    }
    return back(isAppError(err) ? err.message : "Couldn't start the connection. Please try again.");
  }
}
