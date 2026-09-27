/** Decrypted OAuth2 token set, stored (as JSON) inside a ToolCredential's encrypted ciphertext. */
export interface OAuthTokenBundle {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  scope: string;
}

export interface ProviderOAuthConfig {
  provider: "google" | "hubspot";
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID" | "HUBSPOT_OAUTH_CLIENT_ID";
  clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET" | "HUBSPOT_OAUTH_CLIENT_SECRET";
  /** Extra query params merged into the authorize URL (e.g. Google's offline access). */
  extraAuthorizeParams?: Record<string, string>;
}
