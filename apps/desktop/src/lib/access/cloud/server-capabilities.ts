import { buildProliferateApiUrl } from "@/lib/infra/proliferate-api";
import {
  parseServerCapabilities,
  type ServerCapabilityContract,
} from "@/lib/domain/capabilities/server-capability-contract";

const SERVER_CAPABILITIES_TIMEOUT_MS = 2_500;

/**
 * Fetch the connected control plane's capability contract from `GET /meta`.
 *
 * Returns `null` when the server is unreachable, the response is malformed, or
 * the server is too old to declare capabilities. Callers treat `null`
 * conservatively; the official-hosted fallback is applied one layer up.
 */
export async function fetchServerCapabilities(): Promise<ServerCapabilityContract | null> {
  const abortController =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = abortController
    ? globalThis.setTimeout(
        () => abortController.abort(),
        SERVER_CAPABILITIES_TIMEOUT_MS,
      )
    : null;

  try {
    const response = await fetch(buildProliferateApiUrl("/meta"), {
      headers: { Accept: "application/json" },
      signal: abortController?.signal,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;
    return parseServerCapabilities((body as Record<string, unknown>).capabilities);
  } catch {
    return null;
  } finally {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}
