import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { OAUTH_PROVIDERS } from "@/lib/integrations/oauth/providers";
import { NEVER_EXPIRES, type OAuthProviderId, type OAuthTokenBundle, type ProviderOAuthConfig } from "@/lib/integrations/oauth/types";

/** A credential's ciphertext holds this JSON for OAuth2 credentials. */
export function encodeBundle(bundle: OAuthTokenBundle): string {
  return encryptSecret(JSON.stringify(bundle));
}

function decodeBundle(ciphertext: string): OAuthTokenBundle {
  try {
    return JSON.parse(decryptSecret(ciphertext)) as OAuthTokenBundle;
  } catch {
    throw new AppError("NOT_CONFIGURED", "This connection's stored credentials are unreadable. Reconnect it.");
  }
}

function appCredentials(config: ProviderOAuthConfig, wasConfigured = false) {
  const clientId = env()[config.clientIdEnv];
  const clientSecret = env()[config.clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new AppError("NOT_CONFIGURED", `${config.label} OAuth app credentials are ${wasConfigured ? "no longer" : "not"} configured on this platform.`);
  }
  return { clientId, clientSecret };
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Calls a provider's token endpoint. GitHub reports failures as HTTP 200 with an `error` field, so both are checked. */
async function requestToken(config: ProviderOAuthConfig, params: Record<string, string>) {
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(params),
  });
  const text = await res.text().catch(() => "");
  let json: TokenResponse = {};
  try {
    json = JSON.parse(text) as TokenResponse;
  } catch {
    // Not JSON — the status and raw text are reported instead.
  }
  return { status: res.status, ok: res.ok && !json.error && !!json.access_token, json, text };
}

const expiryOf = (expiresIn: number | undefined) => (expiresIn ? Date.now() + expiresIn * 1000 : NEVER_EXPIRES);

/** Exchanges an authorization code for the initial token set. */
export async function exchangeCodeForToken(provider: OAuthProviderId, code: string, redirectUri: string): Promise<OAuthTokenBundle> {
  const config = OAUTH_PROVIDERS[provider];
  const { clientId, clientSecret } = appCredentials(config);
  const res = await requestToken(config, { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret });
  if (!res.ok) {
    const reason = res.json.error_description || res.json.error || res.text;
    throw new AppError("INTEGRATION_ERROR", `${config.label} rejected the authorization code (HTTP ${res.status}): ${reason.slice(0, 300)}`);
  }
  if (config.refreshable && !res.json.refresh_token) {
    throw new AppError("INTEGRATION_ERROR", `${config.label} didn't return a refresh token. Revoke this app's access in your ${config.label} account and reconnect.`);
  }
  return {
    accessToken: res.json.access_token!,
    refreshToken: res.json.refresh_token ?? "",
    expiresAt: expiryOf(res.json.expires_in),
    scope: res.json.scope ?? config.scopes.join(" "),
  };
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

async function needsReauth(credentialId: string, reason: string) {
  await prisma.integrationConnection.updateMany({ where: { credentialId }, data: { status: "NEEDS_REAUTH", lastError: reason } });
}

/**
 * Returns a live access token for an OAuth2 ToolCredential, refreshing and
 * persisting it first if it's within 5 minutes of expiring.
 */
export async function getValidAccessToken(credentialId: string, provider: OAuthProviderId): Promise<string> {
  const cred = await prisma.toolCredential.findFirst({ where: { id: credentialId, revokedAt: null } });
  if (!cred) throw new AppError("NOT_CONFIGURED", "This integration's credentials were removed. Reconnect it.");
  const bundle = decodeBundle(cred.ciphertext);
  if (Date.now() < bundle.expiresAt - REFRESH_MARGIN_MS) return bundle.accessToken;

  const config = OAUTH_PROVIDERS[provider];
  const reconnect = new AppError("NOT_CONFIGURED", `The ${config.label} connection needs to be reconnected.`);
  if (!bundle.refreshToken) {
    await needsReauth(credentialId, "The access token expired and can't be refreshed.");
    throw reconnect;
  }

  const { clientId, clientSecret } = appCredentials(config, true);
  const res = await requestToken(config, { grant_type: "refresh_token", refresh_token: bundle.refreshToken, client_id: clientId, client_secret: clientSecret });
  if (!res.ok) {
    // The refresh token itself may be dead (revoked at the provider); surface as a reauth case.
    await needsReauth(credentialId, `Token refresh failed (HTTP ${res.status}).`);
    throw reconnect;
  }
  const next: OAuthTokenBundle = {
    accessToken: res.json.access_token!,
    refreshToken: res.json.refresh_token ?? bundle.refreshToken,
    expiresAt: expiryOf(res.json.expires_in),
    scope: res.json.scope ?? bundle.scope,
  };
  await prisma.toolCredential.update({ where: { id: credentialId }, data: { ciphertext: encodeBundle(next) } });
  return next.accessToken;
}
