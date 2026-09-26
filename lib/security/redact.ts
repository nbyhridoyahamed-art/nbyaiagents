/**
 * Removes secrets from anything that is about to be logged, audited or shown.
 * Applied to tool parameters, HTTP headers and error messages before persistence.
 */
const SENSITIVE_KEY =
  /(pass(word)?|secret|token|api[-_]?key|authorization|auth|cookie|credential|private[-_]?key|client[-_]?secret|signature|ssn|card[-_]?number|cvv)/i;

const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic style keys
  /\bAIza[0-9A-Za-z_-]{20,}/g, // Google API keys
  /\bnby_(?:live|test)_[A-Za-z0-9_-]{16,}/g, // our own API keys
  /\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g, // Slack
];

export const REDACTED = "[REDACTED]";

export function redactString(value: string): string {
  let out = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return "[…]" as unknown as T;
  if (value == null) return value;
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) && v != null && v !== "" ? REDACTED : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** Truncates large payloads for logs while keeping them valid JSON-ish. */
export function summarizeForLog(value: unknown, maxChars = 2000): unknown {
  const safe = redact(value);
  const json = JSON.stringify(safe);
  if (json === undefined || json.length <= maxChars) return safe;
  return { truncated: true, preview: json.slice(0, maxChars) };
}
