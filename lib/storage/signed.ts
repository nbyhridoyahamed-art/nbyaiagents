import { signValue } from "@/lib/security/crypto";

/** Short-lived signed URL for a private file. The route also requires an authenticated member of the owning org. */
export function signedFileUrl(fileId: string, ttlMs = 5 * 60 * 1000) {
  const exp = Date.now() + ttlMs;
  return `/api/files/${fileId}?exp=${exp}&sig=${signValue(fileId, exp)}`;
}
