/**
 * Secret redaction for managed-cloud world evidence and logs.
 *
 * Ported in spirit from the combined worktree's report/redaction.ts (secure
 * env loading + secret redaction is one of the explicitly portable pieces),
 * but kept self-contained here so the managed-cloud world never depends on a
 * file outside its ownership. Redacts every declared-secret value plus
 * caller-supplied ephemeral secrets (raw virtual keys, provider keys, refresh
 * tokens, setup tokens) that never enter the environment manifest, and always
 * strips URL userinfo.
 */

const REDACTION = "[REDACTED_SECRET]";

export interface RedactionOptions {
  /** Concrete secret values to redact (env values, minted keys, tokens). */
  readonly secrets?: readonly (string | undefined)[];
}

/**
 * Replaces every known secret value (and common encodings of it) with a fixed
 * marker, longest-first so a value that is a prefix of another cannot leak.
 */
export function redactSecrets(input: string, options: RedactionOptions = {}): string {
  const variants = new Set<string>();
  for (const secret of options.secrets ?? []) {
    if (!secret || secret.length < 4) {
      // Ignore trivially short values: redacting them would corrupt ordinary
      // text without protecting anything meaningful.
      continue;
    }
    variants.add(secret);
    variants.add(encodeURIComponent(secret));
    variants.add(Buffer.from(secret, "utf8").toString("base64"));
    variants.add(Buffer.from(`x-access-token:${secret}`, "utf8").toString("base64"));
  }
  let redacted = input;
  for (const value of [...variants].sort((left, right) => right.length - left.length)) {
    if (value.length > 0) {
      redacted = redacted.split(value).join(REDACTION);
    }
  }
  // Defense in depth for URL userinfo even when the token came from a
  // short-lived provider response rather than a declared secret.
  return redacted.replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, `$1${REDACTION}@`);
}

/**
 * Asserts a payload bound for evidence contains no known secret value. Throws
 * with a NAME (never the value) so a redaction-policy violation fails loudly at
 * write time rather than leaking. Returns the input for chaining.
 */
export function assertNoSecret<T>(payload: T, secretsByName: Readonly<Record<string, string | undefined>>): T {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
  for (const [name, value] of Object.entries(secretsByName)) {
    if (value && value.length >= 4 && serialized.includes(value)) {
      throw new Error(
        `redaction violation: evidence payload contains the value of ${name}; never persist secret values.`,
      );
    }
  }
  return payload;
}
