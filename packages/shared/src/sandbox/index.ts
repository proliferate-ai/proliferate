/**
 * Shared Sandbox Utilities
 *
 * Common utilities for sandbox providers including:
 * - Configuration templates (Caddyfile, plugin, env instructions)
 * - OpenCode config generation and readiness checks
 * - Error handling with secret redaction
 * - Fetch utilities with timeouts
 */

// Configuration templates
export {
	PLUGIN_MJS,
	DEFAULT_CADDYFILE,
	ENV_INSTRUCTIONS,
	SANDBOX_PATHS,
	SANDBOX_PORTS,
	SANDBOX_TIMEOUT_MS,
	SANDBOX_TIMEOUT_SECONDS,
	shellEscape,
	capOutput,
	parseServiceCommands,
	parsePrebuildServiceCommands,
	resolveServiceCommands,
} from "./config";

// OpenCode utilities
export {
	getOpencodeConfig,
	waitForOpenCodeReady,
	type SessionMetadata,
} from "./opencode";

// Error handling
export {
	SandboxProviderError,
	redactSecrets,
	isSandboxProviderError,
	type SandboxOperation,
} from "./errors";

// Version key
export { computeBaseSnapshotVersionKey } from "./version-key";

// Fetch utilities
export {
	fetchWithTimeout,
	providerFetch,
	DEFAULT_TIMEOUTS,
	type FetchWithTimeoutOptions,
} from "./fetch";
