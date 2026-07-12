import { inspect } from "node:util";

import { ENV_MANIFEST } from "../config/env-manifest.js";

const REDACTION = "[REDACTED_SECRET]";

/** Redact every materialized secret declared by the canonical environment
 * manifest, plus caller-supplied ephemeral values that never enter env. */
export function redactSecrets(
  input: string,
  options: { env?: NodeJS.ProcessEnv; additionalSecrets?: readonly string[] } = {},
): string {
  const env = options.env ?? process.env;
  const values = [
    ...ENV_MANIFEST.filter(({ secret }) => secret)
      .map(({ name }) => env[name])
      .filter((value): value is string => Boolean(value)),
    ...(options.additionalSecrets ?? []).filter(Boolean),
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

/** Install once at the release-runner boundary so scenario diagnostics cannot
 * bypass report redaction by writing directly to stdout/stderr. */
export function installSecretRedactingConsole(
  env: NodeJS.ProcessEnv = process.env,
): () => void {
  const methods = ["log", "error", "warn", "info", "debug"] as const;
  const originals = new Map<(typeof methods)[number], (...data: unknown[]) => void>();
  for (const method of methods) {
    const original = console[method].bind(console) as (...data: unknown[]) => void;
    originals.set(method, original);
    console[method] = ((...data: unknown[]) => {
      original(...data.map((value) => redactConsoleValue(value, env)));
    }) as typeof console[typeof method];
  }
  return () => {
    for (const [method, original] of originals) {
      console[method] = original as typeof console[typeof method];
    }
  };
}

function redactConsoleValue(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof value === "string") {
    return redactSecrets(value, { env });
  }
  if (value instanceof Error) {
    return redactSecrets(value.stack ?? value.message, { env });
  }
  if (value !== null && typeof value === "object") {
    return redactSecrets(inspect(value, { depth: 8, breakLength: 120 }), { env });
  }
  return value;
}
