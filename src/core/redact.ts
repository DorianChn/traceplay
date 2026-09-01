/**
 * Secret redaction for persisted headers and request/response bodies.
 *
 * Cassettes are often committed to git or shared. We never persist raw
 * credentials. Redaction happens at record time, before any append.
 */

const SECRET_HEADER_PATTERN =
  /^(authorization|api-key|x-api-key|cookie|set-cookie|proxy-authorization|x-auth-token|x-openai-api-key)$/i;

const SECRET_BODY_KEY_PATTERN =
  /^(api[_-]?key|secret|password|token|authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)$/i;

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SECRET_HEADER_PATTERN.test(key) ? '[REDACTED]' : value;
  }
  return out;
}

export function redactBody(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactBody);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      out[key] = SECRET_BODY_KEY_PATTERN.test(key) ? '[REDACTED]' : redactBody(val);
    }
    return out;
  }
  return value;
}
