// Tauri-only IO for the "connect to a self-hosted server" flow. The web build
// has no Tauri bridge and no `set_app_config` command — every entry point here
// is gated on
// `isTauriRuntimeAvailable()` (mirrors the `isTauriDockApiAvailable`-style
// checks elsewhere in lib/access/tauri/) so the plain web build never throws.

export function isTauriRuntimeAvailable(): boolean {
  return typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

export type FetchServerMetaResult =
  | { ok: true; meta: import("@/lib/domain/auth/connect-server").ServerMeta }
  | { ok: false; error: string };

/**
 * Probe `{url}/meta` (server/proliferate/server/meta.py) to confirm the
 * address is actually a Proliferate server before ever offering the
 * trust-confirmation step. A non-200 response, a network failure, or a body
 * that doesn't structurally match `MetaResponse` all read as "not a
 * Proliferate server" — never a thrown exception.
 */
const FETCH_SERVER_META_TIMEOUT_MS = 8_000;

export async function fetchServerMeta(url: string): Promise<FetchServerMetaResult> {
  const { isServerMetaShape } = await import("@/lib/domain/auth/connect-server");
  const abortController = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = abortController
    ? globalThis.setTimeout(() => abortController.abort(), FETCH_SERVER_META_TIMEOUT_MS)
    : null;

  let response: Response;
  try {
    response = await fetch(`${url}/meta`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: abortController?.signal,
    });
  } catch {
    return { ok: false, error: "Could not reach that address." };
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }

  if (!response.ok) {
    return { ok: false, error: "That address isn't a Proliferate server." };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "That address isn't a Proliferate server." };
  }

  if (!isServerMetaShape(body)) {
    return { ok: false, error: "That address isn't a Proliferate server." };
  }

  return { ok: true, meta: body };
}
