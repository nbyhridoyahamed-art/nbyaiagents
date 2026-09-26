/**
 * The client's IP for rate limiting and audit. Only proxy-appended entries of
 * X-Forwarded-For can be trusted: the leftmost values are whatever the client sent.
 * Behind N trusted proxies (default 1), the Nth entry from the right is the address
 * the outermost proxy saw. Set TRUSTED_PROXY_HOPS to match your deployment.
 */
export function clientIp(headers: Headers): string | undefined {
  const hops = Math.max(1, Math.floor(Number(process.env.TRUSTED_PROXY_HOPS ?? 1)) || 1);
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (chain.length) return chain[Math.max(0, chain.length - hops)];
  return headers.get("x-real-ip")?.trim() || undefined;
}
