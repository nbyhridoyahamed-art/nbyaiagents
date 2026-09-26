import crypto from "node:crypto";
import { env } from "@/lib/env";

/**
 * AES-256-GCM envelope for secrets at rest (API keys, OAuth tokens, webhook secrets).
 * Format: v<keyVersion>.<iv b64url>.<tag b64url>.<ciphertext b64url>
 * keyVersion supports future key rotation (decrypt with old key, re-encrypt with new).
 */
const KEY_VERSION = 1;

function key(): Buffer {
  return Buffer.from(env().ENCRYPTION_KEY, "base64");
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [`v${KEY_VERSION}`, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(".");
  if (version !== `v${KEY_VERSION}` || !ivB64 || !tagB64 || ctB64 === undefined) {
    throw new Error("Unsupported secret format");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
}

/** Non-reversible display hint, e.g. "••••3f9a". Never reveals more than 4 chars. */
export function secretHint(plaintext: string): string {
  const tail = plaintext.length >= 12 ? plaintext.slice(-4) : "";
  return `••••${tail}`;
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hmacSha256(secret: string, value: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Signs a short-lived value (e.g. file download URLs). */
export function signValue(value: string, expiresAtMs: number): string {
  return hmacSha256(env().SIGNING_SECRET, `${value}.${expiresAtMs}`);
}

export function verifySignedValue(value: string, expiresAtMs: number, signature: string): boolean {
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return false;
  return safeEqual(signValue(value, expiresAtMs), signature);
}
