/**
 * Secret redaction for local-runtime world evidence and logs.
 *
 * Ported from the combined foundation worktree's `report/redaction.ts`. Every
 * secret declared by the env manifest is stripped from any string before it can
 * reach a log, evidence record, or the final answer — along with common
 * encodings (URL-encoded, base64, git `x-access-token:` basic-auth). Additional
 * ephemeral secrets (a raw virtual key fetched from the product state endpoint,
 * never stored in env) are passed via `additionalSecrets`.
 *
 * The tier-3 evidence contract is explicit: "Secrets, raw virtual keys,
 * provider keys, refresh tokens, setup tokens, and integration credentials
 * never enter logs or evidence."
 */

import { inspect } from "node:util";

import { ENV_MANIFEST } from "../../../config/env-manifest.js";

const REDACTION = "[REDACTED_SECRET]";

export function redactSecrets(
  input: string,
  options: { env?: NodeJS.ProcessEnv; additionalSecrets?: readonly string[] } = {},
): string {
  const env = options.env ?? process.env;
  const values = [
    ...ENV_MANIFEST.filter(({ secret }) => secret)
      .map(({ name }) => env[name])
      .filter((value): value is string => Boolean(value)),
    ...(options.additionalSecrets ?? []).filter((v): v is string => Boolean(v)),
  ];
  const variants = new Set<string>();
  for (const value of values) {
    variants.add(value);
    variants.add(encodeURIComponent(value));
    variants.add(Buffer.from(value, "utf8").toString("base64"));
    variants.add(Buffer.from(`x-access-token:${value}`, "utf8").toString("base64"));
  }

  let redacted = input;
  for (const value of [...variants].sort((left, right) => right.length - left.length)) {
    if (value.length > 0) {
      redacted = redacted.split(value).join(REDACTION);
    }
  }
  // Defense in depth for URL userinfo even when its value came from a
  // short-lived provider response rather than the environment manifest.
  return redacted.replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, `$1${REDACTION}@`);
}

/** Redact an arbitrary value for evidence/logging (strings, errors, objects). */
export function redactValue(
  value: unknown,
  options: { env?: NodeJS.ProcessEnv; additionalSecrets?: readonly string[] } = {},
): string {
  if (typeof value === "string") {
    return redactSecrets(value, options);
  }
  if (value instanceof Error) {
    return redactSecrets(value.stack ?? value.message, options);
  }
  if (value !== null && typeof value === "object") {
    return redactSecrets(inspect(value, { depth: 8, breakLength: 120 }), options);
  }
  return redactSecrets(String(value), options);
}
