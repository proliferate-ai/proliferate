/**
 * Readiness probes for the managed-cloud world. Every probe returns a
 * ReadinessObservation (frozen contract, world.ts) with a SANITIZED detail —
 * status/timing/host only, never a body that could carry a secret. A required
 * boundary that fails readiness makes the provisioner throw
 * WorldReadinessError; conditional capabilities are recorded but not fatal.
 */

import type { ReadinessObservation } from "../../contracts/world.js";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ProbeOptions {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  /** Extra headers (e.g. bearer) — never echoed into the observation detail. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Status codes that count as "ready". Default: any 2xx. */
  readonly acceptStatus?: (status: number) => boolean;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

/**
 * Probes an HTTP endpoint and reports readiness. Network errors and non-accept
 * statuses are captured as `ok: false` observations rather than thrown, so the
 * provisioner can aggregate every boundary's state into one WorldReadinessError.
 */
export async function probeHttp(
  check: string,
  url: string,
  options: ProbeOptions = {},
): Promise<ReadinessObservation> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const accept = options.acceptStatus ?? ((s) => s >= 200 && s < 300);
  const start = now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  const observedAt = new Date().toISOString();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: options.headers,
      signal: controller.signal,
    });
    const ms = now() - start;
    const ok = accept(response.status);
    return {
      check,
      ok,
      detail: `GET ${safeHost(url)} ${response.status} in ${ms}ms`,
      observedAt,
    };
  } catch (error) {
    const ms = now() - start;
    const reason = error instanceof Error ? error.name : "error";
    return {
      check,
      ok: false,
      detail: `GET ${safeHost(url)} failed (${reason}) after ${ms}ms`,
      observedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** A synchronous, non-network readiness fact (e.g. "credential present"). */
export function fact(check: string, ok: boolean, detail: string): ReadinessObservation {
  return { check, ok, detail, observedAt: new Date().toISOString() };
}
