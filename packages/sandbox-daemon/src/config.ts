/**
 * Daemon configuration.
 *
 * Centralized configuration constants and env-derived settings
 * for the sandbox daemon process.
 */

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/** Port the daemon HTTP server binds to inside the sandbox. */
export const DAEMON_PORT = 8470;

// ---------------------------------------------------------------------------
// Preview port policy
// ---------------------------------------------------------------------------

export const PREVIEW_PORT_MIN = 3000;
export const PREVIEW_PORT_MAX = 9999;

/** Infrastructure ports that must never be proxied, even if in range. */
export const DENYLISTED_PORTS = new Set([22, 2375, 2376, 2468, 26500, DAEMON_PORT]);

/** How often to poll `ss -tln` for listening ports (ms). */
export const PORT_POLL_INTERVAL_MS = 500;

/**
 * Number of consecutive polls a port must be seen listening
 * before we emit `port_opened`. Prevents flapping from
 * processes that bind/unbind quickly during startup.
 */
export const PORT_STABILITY_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// PTY ring buffer
// ---------------------------------------------------------------------------

export const PTY_MAX_LINES = 10_000;
export const PTY_MAX_BYTES = 8 * 1024 * 1024; // 8 MB
export const PTY_MAX_LINE_LENGTH = 16 * 1024; // 16 KB

// ---------------------------------------------------------------------------
// FS transport
// ---------------------------------------------------------------------------

export const FS_WRITE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const WORKSPACE_ROOT = "/home/user/workspace";

// ---------------------------------------------------------------------------
// Auth / token
// ---------------------------------------------------------------------------

/** Default token TTL in minutes. */
export const TOKEN_TTL_MINUTES = 60;

/** Max nonces kept in replay cache before oldest is evicted. */
export const NONCE_CACHE_MAX = 10_000;

/** Window (ms) outside which a nonce is too old regardless of cache. */
export const NONCE_EXPIRY_WINDOW_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Derived runtime config
// ---------------------------------------------------------------------------

export interface DaemonConfig {
	port: number;
	sessionToken: string | null;
	signatureSecret: string | null;
	workspaceRoot: string;
}

export function loadConfig(_argv: string[]): DaemonConfig {
	// biome-ignore lint/nursery/noProcessEnv: loadConfig IS the centralized config entry point
	const env = process.env;
	return {
		port: Number(env.SANDBOX_DAEMON_PORT) || DAEMON_PORT,
		sessionToken: env.PROLIFERATE_SESSION_TOKEN ?? null,
		signatureSecret: env.PROLIFERATE_SIGNATURE_SECRET ?? null,
		workspaceRoot: env.PROLIFERATE_WORKSPACE_ROOT ?? WORKSPACE_ROOT,
	};
}
