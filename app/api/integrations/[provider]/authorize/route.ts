import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth/context";
import { env } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { isIntegrationConfigured } from "@/lib/integrations/catalog";
import { OAUTH_PROVIDERS, PROVIDER_INTEGRATION_KEYS, isOAuthProvider } from "@/lib/integrations/oauth/providers";
import { encodeState } from "@/lib/integrations/oauth/state";
import { appUrl } from "@/lib/url";

/**
 * GET /api/integrations/{provider}/authorize — starts the OAuth consent flow.
 * A real page navigation (clicked from /integrations), not a fetch/server action:
 * on any problem this redirects back rather than rendering a raw error.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/integrations/[provider]/authorize">) {
  const { provider } = await ctx.params;
  const back = (error?: string) => NextResponse.redirect(appUrl(error ? `/integrations?error=${encodeURIComponent(error)}` : "/integrations"));

  if (!isOAuthProvider(provider)) return back("Unknown integration provider.");

  try {
    const orgCtx = await requireOrgContext("tools:manage");
    const representativeKey = PROVIDER_INTEGRATION_KEYS[provider][0];
    if (!representativeKey || !isIntegrationConfigured(representativeKey)) {
      return back(`${provider === "google" ? "Google" : "HubSpot"} isn't configured on this platform yet.`);
    }

    const config = OAUTH_PROVIDERS[provider];
    const clientId = env()[config.clientIdEnv];
    const state = encodeState({ orgId: orgCtx.org.id, userId: orgCtx.user.id, provider });
    const url = new URL(config.authorizeUrl);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", `${env().APP_URL}/api/integrations/${provider}/callback`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.scopes.join(" "));
    url.searchParams.set("state", state);
    for (const [key, value] of Object.entries(config.extraAuthorizeParams ?? {})) url.searchParams.set(key, value);

    return NextResponse.redirect(url);
  } catch (err) {
    if (isAppError(err) && err.code === "UNAUTHENTICATED") return NextResponse.redirect(appUrl("/login?next=%2Fintegrations"));
    return back(isAppError(err) ? err.message : "Couldn't start the connection. Please try again.");
  }
}
