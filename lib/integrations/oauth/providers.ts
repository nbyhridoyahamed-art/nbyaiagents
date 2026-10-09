import type { OAuthProviderId, ProviderOAuthConfig } from "@/lib/integrations/oauth/types";

/**
 * One OAuth app per provider, shared by every org. Gmail, Google Calendar, Google
 * Sheets, Search Console and Analytics are separate catalog entries but request all
 * their scopes in a single Google consent screen — see app/api/integrations/[provider]/callback.
 */
export const OAUTH_PROVIDERS: Record<OAuthProviderId, ProviderOAuthConfig> = {
  google: {
    provider: "google",
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/webmasters.readonly",
      "https://www.googleapis.com/auth/analytics.readonly",
    ],
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    // access_type=offline + prompt=consent guarantee a refresh_token on every grant.
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
    refreshable: true,
  },
  hubspot: {
    provider: "hubspot",
    label: "HubSpot",
    authorizeUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
    clientIdEnv: "HUBSPOT_OAUTH_CLIENT_ID",
    clientSecretEnv: "HUBSPOT_OAUTH_CLIENT_SECRET",
    refreshable: true,
  },
  github: {
    provider: "github",
    label: "GitHub",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    // GitHub's classic OAuth apps have no read-only scope for private repositories, so "repo" is the
    // narrowest scope that lets the tools see them. People who want less can connect a fine-grained token instead.
    scopes: ["repo", "read:user"],
    clientIdEnv: "GITHUB_OAUTH_CLIENT_ID",
    clientSecretEnv: "GITHUB_OAUTH_CLIENT_SECRET",
    // Tokens last until revoked. (If the operator turns on GitHub's token expiry, a refresh token is returned and used.)
    refreshable: false,
  },
};

/** Catalog keys that share one OAuth grant for a given provider (see providers above). */
export const PROVIDER_INTEGRATION_KEYS: Record<OAuthProviderId, string[]> = {
  google: ["gmail", "google_calendar", "google_sheets", "google_search_console", "google_analytics"],
  hubspot: ["hubspot"],
  github: ["github"],
};

export function isOAuthProvider(value: string): value is OAuthProviderId {
  return Object.hasOwn(OAUTH_PROVIDERS, value);
}

/** e.g. "gmail" / "google_calendar" / "google_sheets" → "google", "hubspot" → "hubspot". */
export function providerForIntegration(integrationKey: string): OAuthProviderId | null {
  for (const [provider, keys] of Object.entries(PROVIDER_INTEGRATION_KEYS) as [OAuthProviderId, string[]][]) {
    if (keys.includes(integrationKey)) return provider;
  }
  return null;
}
