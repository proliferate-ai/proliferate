/**
 * Redaction for env-gated failure diagnostics (`LOCAL_WORLD_SMOKE_DEBUG_DIR`).
 *
 * These DOM/console/network/JSON dumps are uploaded as CI artifacts, so they
 * must never carry a credential. Two layers:
 *
 *   - key-name redaction: any object property whose name looks secret-bearing
 *     (key/token/secret/password/authorization/bearer/credential) is replaced
 *     wholesale, so e.g. the LiteLLM virtual key inside a pushed agent-auth
 *     `state.json` never survives; and
 *   - value scrubbing: obvious secret shapes (`Bearer …`, `sk-…`, `vk-…`, JWTs)
 *     are scrubbed from every free-text string, catching credentials embedded in
 *     network bodies, WebSocket frames, and console lines.
 *
 * Non-secret identifiers (workspace/session ids, request ids) are intentionally
 * left intact so the diagnostics stay useful.
 */

const SECRET_KEY_PATTERN = /(key|token|secret|password|authorization|bearer|credential)/i;

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /\bsk-[A-Za-z0-9._-]{6,}/gi,
  /\bvk-[A-Za-z0-9._-]{6,}/gi,
  // E2B API keys (`e2b_…`) — the self-host cloud-addon diagnostic greps `e2b`
  // lines, so a bootstrap/preflight line echoing the raw key must be redacted.
  /\be2b_[A-Za-z0-9._-]{6,}/gi,
  /\beyJ[A-Za-z0-9._-]{10,}/g,
];

/** Scrubs obvious secret shapes from a free-text string. */
export function scrubSecretText(input: string): string {
  let out = input;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

/** Deep-redacts a JSON-ish value by secret key name and secret value shape. */
export function redactDiagnostics(value: unknown): unknown {
  if (typeof value === "string") {
    return scrubSecretText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactDiagnostics(entry));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactDiagnostics(entry);
    }
    return out;
  }
  return value;
}
