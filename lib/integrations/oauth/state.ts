import { AppError } from "@/lib/errors";
import { signValue, verifySignedValue } from "@/lib/security/crypto";
import type { OAuthProviderId } from "@/lib/integrations/oauth/types";

export interface OAuthState {
  orgId: string;
  userId: string;
  provider: OAuthProviderId;
  /** The sign-in is running in a popup window, so the callback reports back to the page that opened it. */
  popup?: boolean;
}

const STATE_TTL_MS = 10 * 60 * 1000;

/** Signed, tamper-proof `state` param — proves the callback belongs to the org/user who started it. */
export function encodeState(state: OAuthState): string {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  const expiresAt = Date.now() + STATE_TTL_MS;
  const signature = signValue(payload, expiresAt);
  return [payload, expiresAt, signature].join(".");
}

export function decodeState(raw: string): OAuthState {
  const [payload, expiresAtStr, signature] = raw.split(".");
  const expiresAt = Number(expiresAtStr);
  if (!payload || !signature || !verifySignedValue(payload, expiresAt, signature)) {
    throw new AppError("VALIDATION", "This connection link has expired or is invalid. Try connecting again.");
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
  } catch {
    throw new AppError("VALIDATION", "This connection link is invalid. Try connecting again.");
  }
}

/** Like {@link decodeState} but returns null instead of throwing — for deciding how to report a failure. */
export function tryDecodeState(raw: string | null): OAuthState | null {
  if (!raw) return null;
  try {
    return decodeState(raw);
  } catch {
    return null;
  }
}
