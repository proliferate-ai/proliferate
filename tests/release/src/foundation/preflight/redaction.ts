/**
 * Secret redaction for the foundation runner.
 *
 * Self-contained (does not depend on any workstream's env manifest): the caller
 * supplies the exact secret VALUES to redact — never names. Redaction covers the
 * raw value plus the common encodings a value takes on the wire (URL-encoded,
 * base64, and the `x-access-token:<value>` basic-auth base64 GitHub helpers
 * emit). URL userinfo is scrubbed structurally as defense-in-depth even when a
 * short-lived provider value never entered the supplied set.
 *
 * Ported pattern from the combined worktree's report/redaction.ts, reduced to a
 * value-driven form so it has no cross-workstream dependency.
 */

import { inspect } from "node:util";

export const REDACTION = "[REDACTED_SECRET]";

function variantsOf(secretValues: readonly string[]): string[] {
  const variants = new Set<string>();
  for (const value of secretValues) {
    if (!value || value.length === 0) continue;
    variants.add(value);
    variants.add(encodeURIComponent(value));
    variants.add(Buffer.from(value, "utf8").toString("base64"));
    variants.add(Buffer.from(`x-access-token:${value}`, "utf8").toString("base64"));
  }
  // Longest-first so a value that is a prefix of another is not left half-redacted.
  return [...variants].sort((a, b) => b.length - a.length);
}

export function redactSecrets(input: string, secretValues: readonly string[] = []): string {
  let redacted = input;
  for (const value of variantsOf(secretValues)) {
    if (value.length > 0) {
      redacted = redacted.split(value).join(REDACTION);
    }
  }
  return redacted.replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, `$1${REDACTION}@`);
}

/** Redact a value of any shape for diagnostic emission (strings, errors, objects). */
export function redactValue(value: unknown, secretValues: readonly string[] = []): unknown {
  if (typeof value === "string") return redactSecrets(value, secretValues);
  if (value instanceof Error) return redactSecrets(value.stack ?? value.message, secretValues);
  if (value !== null && typeof value === "object") {
    return redactSecrets(inspect(value, { depth: 8, breakLength: 120 }), secretValues);
  }
  return value;
}

/**
 * Key policy for evidence payloads. Evidence records only safe identity; a key
 * whose name looks like a raw credential is rejected at write time so a
 * misbehaving collector cannot smuggle a secret into immutable evidence.
 */
const FORBIDDEN_KEY = /(^|[_-])(secret|password|passwd|token|apikey|api_key|privatekey|private_key|credential|bearer|authorization)([_-]|$)/i;

/** Keys explicitly allowed even though they contain a forbidden-looking substring. */
const ALLOWED_KEY = new Set<string>([
  // safe identifiers that reference a secret without carrying its value
  "virtualKeyId",
  "keyId",
  "tokenId",
  "credentialId",
]);

export function forbiddenSecretKey(key: string): boolean {
  if (ALLOWED_KEY.has(key)) return false;
  return FORBIDDEN_KEY.test(key);
}

/**
 * Recursively asserts no object key in `payload` matches the forbidden-key
 * policy. Returns the offending key path, or null when the payload is clean.
 */
export function findForbiddenKey(payload: unknown, path: string[] = []): string | null {
  if (payload === null || typeof payload !== "object") return null;
  if (Array.isArray(payload)) {
    for (let i = 0; i < payload.length; i += 1) {
      const found = findForbiddenKey(payload[i], [...path, String(i)]);
      if (found) return found;
    }
    return null;
  }
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (forbiddenSecretKey(key)) return [...path, key].join(".");
    const found = findForbiddenKey(value, [...path, key]);
    if (found) return found;
  }
  return null;
}
