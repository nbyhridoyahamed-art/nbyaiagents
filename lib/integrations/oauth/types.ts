/** Providers the platform can sign people in with. Each needs an OAuth app registered by the operator. */
export type OAuthProviderId = "google" | "hubspot" | "github";

/** Decrypted OAuth2 token set, stored (as JSON) inside a ToolCredential's encrypted ciphertext. */
export interface OAuthTokenBundle {
  accessToken: string;
  /** Empty for providers whose tokens don't expire and can't be refreshed (GitHub OAuth apps). */
  refreshToken: string;
  /** Epoch ms. Tokens that never expire use {@link NEVER_EXPIRES}. */
  expiresAt: number;
  scope: string;
}

/** Stored as `expiresAt` for tokens the provider never expires. */
export const NEVER_EXPIRES = Number.MAX_SAFE_INTEGER;

export interface ProviderOAuthConfig {
  provider: OAuthProviderId;
  /** How the provider is named to people ("Google"). */
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID" | "HUBSPOT_OAUTH_CLIENT_ID" | "GITHUB_OAUTH_CLIENT_ID";
  clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET" | "HUBSPOT_OAUTH_CLIENT_SECRET" | "GITHUB_OAUTH_CLIENT_SECRET";
  /** Extra query params merged into the authorize URL (e.g. Google's offline access). */
  extraAuthorizeParams?: Record<string, string>;
  /** False when the provider hands out one long-lived token and no refresh token. */
  refreshable: boolean;
}
