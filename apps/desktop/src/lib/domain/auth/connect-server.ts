// Pure helpers for the "connect to a self-hosted server" flow. Kept
// dependency-free (no Tauri, no fetch) so they can be unit tested directly and
// reused by both the manual-entry dialog and a future deep-link handler.

export interface NormalizedServerUrlOk {
  ok: true;
  /** Absolute URL, https default scheme, no trailing slash. */
  url: string;
  /** Host for display (trust-confirmation copy, quiet connected-server label). */
  host: string;
}

export interface NormalizedServerUrlError {
  ok: false;
  error: string;
}

export type NormalizedServerUrl = NormalizedServerUrlOk | NormalizedServerUrlError;

/**
 * Normalize + validate a user-typed server address:
 * - blank -> error
 * - no scheme -> defaults to `https://`
 * - trailing slash stripped
 * - must parse as an absolute URL with an http/https scheme and a host
 *
 * Never throws — every input maps to an `ok`/error result.
 */
export function normalizeServerUrl(raw: string): NormalizedServerUrl {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Enter a server address." };
  }

  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: "Enter a valid server address." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Server address must start with http:// or https://." };
  }

  if (!parsed.hostname) {
    return { ok: false, error: "Server address must include a host." };
  }

  return {
    ok: true,
    url: parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "")),
    host: parsed.host,
  };
}

/** Shape this desktop understands from `GET {server}/meta` (server/proliferate/server/meta.py). */
export interface ServerMeta {
  serverVersion: string;
  desktopVersion: string;
  runtimeVersion: string;
  workerVersion: string;
  minDesktopVersion: string;
}

/**
 * Structural check that a `/meta` response body is actually shaped like a
 * Proliferate server's `MetaResponse` — a non-200 or a differently-shaped
 * body (any other web server, a typo'd host, etc.) must read as "not a
 * Proliferate server," never as a crash.
 */
export function isServerMetaShape(value: unknown): value is ServerMeta {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.serverVersion === "string"
    && typeof record.desktopVersion === "string"
    && typeof record.runtimeVersion === "string"
    && typeof record.workerVersion === "string"
    && typeof record.minDesktopVersion === "string"
  );
}
