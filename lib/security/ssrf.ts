import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { AppError } from "@/lib/errors";

/**
 * SSRF-safe outbound HTTP for user-defined tools.
 *  - http/https only, no embedded credentials
 *  - every resolved address is checked *at connect time* (defeats DNS rebinding)
 *  - private, loopback, link-local, CGNAT, multicast and metadata ranges are blocked
 *  - redirects are followed manually (max 3) and re-validated
 *  - response size and time are capped
 */

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function v4ToInt(ip: string) {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

export function isPrivateAddress(address: string): boolean {
  const ip = address.startsWith("::ffff:") && net.isIPv4(address.slice(7)) ? address.slice(7) : address;
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return BLOCKED_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (v4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb") ||
      lower.startsWith("ff")
    );
  }
  return true;
}

export function assertSafeUrl(raw: string, allowPrivate = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("VALIDATION", "The URL is not valid.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new AppError("VALIDATION", "Only http and https URLs are allowed.");
  if (url.username || url.password) throw new AppError("VALIDATION", "Put credentials in the tool's authentication settings, not in the URL.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate) {
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
      throw new AppError("VALIDATION", "Requests to local or internal hosts are blocked.");
    }
    if (net.isIP(host) && isPrivateAddress(host)) throw new AppError("VALIDATION", "Requests to private network addresses are blocked.");
  }
  return url;
}

function guardedLookup(allowPrivate: boolean): net.LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = (addresses as dns.LookupAddress[]) ?? [];
      const bad = !allowPrivate && list.some((a) => isPrivateAddress(a.address));
      if (bad || list.length === 0) {
        return callback(Object.assign(new Error("Blocked: destination resolves to a private network address."), { code: "EBLOCKED" }), "", 0);
      }
      if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

export interface SafeRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  maxBytes?: number;
  allowPrivate?: boolean;
}

export interface SafeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  durationMs: number;
}

const SAFE_CROSS_ORIGIN_HEADERS = new Set(["accept", "accept-language", "content-type", "user-agent"]);

export async function safeHttpRequest(req: SafeRequest, redirects = 0): Promise<SafeResponse> {
  const allowPrivate = !!req.allowPrivate;
  const url = assertSafeUrl(req.url, allowPrivate);
  const started = Date.now();
  const maxBytes = req.maxBytes ?? 2 * 1024 * 1024;
  const lib = url.protocol === "https:" ? https : http;

  const res = await new Promise<SafeResponse & { location?: string }>((resolve, reject) => {
    const r = lib.request(
      url,
      {
        method: req.method,
        headers: { "user-agent": "Virtual Desks-AI-Agents/1.0", ...req.headers },
        lookup: guardedLookup(allowPrivate),
        timeout: req.timeoutMs ?? 20_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        response.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            truncated = true;
            response.destroy();
            return;
          }
          chunks.push(c);
        });
        const finish = () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v ?? "")])),
            body: Buffer.concat(chunks).toString("utf8"),
            truncated,
            durationMs: Date.now() - started,
            location: response.headers.location,
          });
        response.on("end", finish);
        response.on("close", finish);
        response.on("error", reject);
      },
    );
    r.on("timeout", () => r.destroy(Object.assign(new Error("Request timed out"), { code: "ETIMEDOUT" })));
    r.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EBLOCKED") reject(new AppError("VALIDATION", "Requests to private network addresses are blocked."));
      else if (err.code === "ETIMEDOUT") reject(new AppError("INTEGRATION_ERROR", "The API did not respond in time."));
      else reject(new AppError("INTEGRATION_ERROR", `Could not reach the API: ${err.code ?? err.message}`));
    });
    if (req.body) r.write(req.body);
    r.end();
  });

  if (res.status >= 300 && res.status < 400 && res.location) {
    if (redirects >= 3) throw new AppError("INTEGRATION_ERROR", "Too many redirects.");
    const nextUrl = new URL(res.location, url);
    const method = res.status === 303 ? "GET" : req.method;
    // Never forward credentials to a different origin: a redirect could otherwise
    // hand the Authorization / API-key header to a server we didn't choose.
    const headers = nextUrl.origin === url.origin ? req.headers : Object.fromEntries(Object.entries(req.headers ?? {}).filter(([k]) => SAFE_CROSS_ORIGIN_HEADERS.has(k.toLowerCase())));
    return safeHttpRequest({ ...req, url: nextUrl.toString(), method, headers, body: method === "GET" ? undefined : req.body }, redirects + 1);
  }
  const { location: _location, ...rest } = res;
  void _location;
  return rest;
}

/**
 * For outbound calls we can't route through `safeHttpRequest` (e.g. an AI SDK's own
 * fetch): validates the URL and checks every address the host resolves to right
 * before use. Narrows DNS-rebinding to a tiny window instead of leaving it open.
 */
export async function assertResolvesPublic(raw: string, allowPrivate = false): Promise<URL> {
  const url = assertSafeUrl(raw, allowPrivate);
  if (allowPrivate || net.isIP(url.hostname.replace(/^\[|\]$/g, ""))) return url;
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new AppError("INTEGRATION_ERROR", `Could not resolve ${url.hostname}.`);
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new AppError("VALIDATION", "That host resolves to a private network address, which is blocked.");
  }
  return url;
}
