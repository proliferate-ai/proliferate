/**
 * Redacted description of credential-shaped strings.
 *
 * Nothing here ever returns a substring of the value it describes — not a
 * prefix, not a truncated fragment. Only length and named, caller-declared
 * shape checks (matching contracts/preflight.ts's `shape` field convention:
 * "sk_test_prefix", "public_https_url", "non_empty", ...) may appear in
 * output. This is deliberately more conservative than most "show me the
 * last 4 chars" credential UIs: a short low-entropy value (a password, a
 * short test token) would leak entirely under that convention.
 */

export type ShapeName =
  | "non_empty"
  | "sk_test_prefix"
  | "sk_live_prefix"
  | "public_https_url"
  | "hex_64"
  | "e2b_key_prefix"
  | "gh_token_prefix";

/** Evaluates one named shape check against a value. Never echoes the value in its return. */
export function matchesShape(shape: ShapeName, value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const trimmed = value.trim();
  switch (shape) {
    case "non_empty":
      return trimmed.length > 0;
    case "sk_test_prefix":
      return trimmed.startsWith("sk_test_");
    case "sk_live_prefix":
      return trimmed.startsWith("sk_live_");
    case "public_https_url":
      return isPublicHttpsUrl(trimmed);
    case "hex_64":
      return /^[0-9a-f]{64}$/i.test(trimmed);
    case "e2b_key_prefix":
      return trimmed.startsWith("e2b_");
    case "gh_token_prefix":
      return /^gh[pousr]_/.test(trimmed);
    default:
      return false;
  }
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * A safe-to-print description of a value's presence/length. Never contains
 * any character of the value itself.
 */
export function describeShape(value: string | undefined): string {
  if (value === undefined) {
    return "absent";
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "empty";
  }
  return `present (${trimmed.length} chars)`;
}

/**
 * Combines the length description with a named shape verdict, e.g.
 * `present (51 chars), sk_test_prefix: yes`. Still never echoes the value.
 */
export function describeShapeCheck(value: string | undefined, shape: ShapeName): string {
  return `${describeShape(value)}, ${shape}: ${matchesShape(shape, value) ? "yes" : "no"}`;
}

/**
 * Test/diagnostic helper: asserts `needle` (a known value, e.g. a planted
 * fake secret) appears nowhere in `haystacks` once stringified. Throws with
 * a redacted message (never repeating `needle`) on violation.
 */
export function assertNeverLeaked(needle: string, haystacks: readonly unknown[]): void {
  for (const [index, haystack] of haystacks.entries()) {
    const serialized = typeof haystack === "string" ? haystack : safeStringify(haystack);
    if (serialized.includes(needle)) {
      throw new Error(`redaction violation: haystack[${index}] contains the planted secret value`);
    }
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
