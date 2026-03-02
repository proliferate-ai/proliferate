/**
 * Daemon configuration.
 *
 * Centralized configuration constants and env-derived settings
 * for the sandbox daemon process.
 */

// ---------------------------------------------------------------------------
// Daemon modes
// ---------------------------------------------------------------------------

export type DaemonMode = "worker" | "manager";

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/** Port the daemon HTTP server binds to inside the sandbox. */
export const DAEMON_PORT = 8470;

/** OpenCode local SSE server inside the sandbox. */
export const OPENCODE_HOST = "127.0.0.1";
export const OPENCODE_PORT = 4096;

// ---------------------------------------------------------------------------
// Preview port policy
// ---------------------------------------------------------------------------

export const PREVIEW_PORT_MIN = 3000;
export const PREVIEW_PORT_MAX = 9999;

/** Infrastructure ports that must never be proxied, even if in range. */
export const DENYLISTED_PORTS = new Set([22, 2375, 2376, 4096, 26500, DAEMON_PORT]);

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
// OpenCode bridge
// ---------------------------------------------------------------------------

/** Timeout (ms) waiting for initial `server.connected` handshake. */
export const OPENCODE_HANDSHAKE_TIMEOUT_MS = 30_000;

/** Reconnect delay (ms) when OpenCode SSE drops. */
export const OPENCODE_RECONNECT_DELAY_MS = 2_000;

/** Max reconnect attempts before giving up (0 = unlimited). */
export const OPENCODE_MAX_RECONNECT_ATTEMPTS = 0;

// ---------------------------------------------------------------------------
// Derived runtime config
// ---------------------------------------------------------------------------

export interface DaemonConfig {
	mode: DaemonMode;
	port: number;
	sessionToken: string | null;
	signatureSecret: string | null;
	workspaceRoot: string;
}

export function loadConfig(argv: string[]): DaemonConfig {
	let mode: DaemonMode = "worker";
	for (const arg of argv) {
		if (arg === "--mode=manager") {
			mode = "manager";
		} else if (arg === "--mode=worker") {
			mode = "worker";
		}
	}

	// biome-ignore lint/nursery/noProcessEnv: loadConfig IS the centralized config entry point
	const env = process.env;
	return {
		mode,
		port: Number(env.SANDBOX_DAEMON_PORT) || DAEMON_PORT,
		sessionToken: env.PROLIFERATE_SESSION_TOKEN ?? null,
		signatureSecret: env.PROLIFERATE_SIGNATURE_SECRET ?? null,
		workspaceRoot: env.PROLIFERATE_WORKSPACE_ROOT ?? WORKSPACE_ROOT,
	};
}
