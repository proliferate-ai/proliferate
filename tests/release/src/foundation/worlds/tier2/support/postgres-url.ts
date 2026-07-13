/**
 * Mirrors tests/intent/stack/seed.ts's `toPostgresDriverUrl` exactly (kept as
 * a tiny local copy rather than importing that file — see
 * support/intent-bridge.ts's header for why this workstream avoids static
 * imports into tests/intent). The server uses asyncpg's SQLAlchemy URL
 * scheme; node-postgres needs the plain `postgresql://` scheme, and its
 * resolver chokes on the bracketed `[::1]` host the macOS profile default
 * uses.
 */
export function toPostgresDriverUrl(url: string): string {
  return url.replace(/^postgresql\+asyncpg:\/\//, "postgresql://").replace("@[::1]:", "@localhost:");
}
