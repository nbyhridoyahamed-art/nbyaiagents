import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { OAUTH_PROVIDERS } from "@/lib/integrations/oauth/providers";
import type { OAuthTokenBundle } from "@/lib/integrations/oauth/types";

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

/** Exchanges an authorization code for the initial token set. */
export async function exchangeCodeForToken(provider: "google" | "hubspot", code: string, redirectUri: string): Promise<OAuthTokenBundle> {
  const config = OAUTH_PROVIDERS[provider];
  const clientId = env()[config.clientIdEnv];
  const clientSecret = env()[config.clientSecretEnv];
  if (!clientId || !clientSecret) throw new AppError("NOT_CONFIGURED", `${provider} OAuth app credentials are not configured on this platform.`);

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError("INTEGRATION_ERROR", `${provider} rejected the authorization code (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
  if (!json.refresh_token) {
    throw new AppError("INTEGRATION_ERROR", `${provider} didn't return a refresh token. Revoke this app's access in your ${provider} account and reconnect.`);
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + json.expires_in * 1000, scope: json.scope ?? config.scopes.join(" ") };
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Returns a live access token for an OAuth2 ToolCredential, refreshing and
 * persisting it first if it's within 5 minutes of expiring.
 */
export async function getValidAccessToken(credentialId: string, provider: "google" | "hubspot"): Promise<string> {
  const cred = await prisma.toolCredential.findFirst({ where: { id: credentialId, revokedAt: null } });
  if (!cred) throw new AppError("NOT_CONFIGURED", "This integration's credentials were removed. Reconnect it.");
  const bundle = decodeBundle(cred.ciphertext);
  if (Date.now() < bundle.expiresAt - REFRESH_MARGIN_MS) return bundle.accessToken;

  const config = OAUTH_PROVIDERS[provider];
  const clientId = env()[config.clientIdEnv];
  const clientSecret = env()[config.clientSecretEnv];
  if (!clientId || !clientSecret) throw new AppError("NOT_CONFIGURED", `${provider} OAuth app credentials are no longer configured on this platform.`);

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: bundle.refreshToken, client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) {
    // The refresh token itself may be dead (revoked at the provider); surface as a reauth case.
    await prisma.integrationConnection.updateMany({ where: { credentialId }, data: { status: "NEEDS_REAUTH", lastError: `Token refresh failed (HTTP ${res.status}).` } });
    throw new AppError("NOT_CONFIGURED", `The ${provider} connection needs to be reconnected.`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string; scope?: string };
  const next: OAuthTokenBundle = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? bundle.refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope ?? bundle.scope,
  };
  await prisma.toolCredential.update({ where: { id: credentialId }, data: { ciphertext: encodeBundle(next) } });
  return next.accessToken;
}
