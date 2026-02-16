/**
 * Sandbox Provider Errors
 *
 * Typed errors for sandbox operations with consistent error handling.
 * These prevent provider-specific error leakage and enable proper retry logic.
 */

export type SandboxProviderType = "modal" | "e2b";

export type SandboxOperation =
	| "createSandbox"
	| "snapshot"
	| "terminate"
	| "pause"
	| "writeEnvFile"
	| "health"
	| "checkSandboxes"
	| "resolveTunnels"
	| "readFiles"
	| "testServiceCommands"
	| "execCommand"
	| "memorySnapshot"
	| "restoreFromMemorySnapshot";

/**
 * Patterns that should be redacted from error messages.
 * Includes API keys, tokens, and other sensitive data.
 */
const REDACT_PATTERNS = [
	// Anthropic API keys
	/sk-ant-[a-zA-Z0-9_-]+/g,
	// Generic API keys
	/api[_-]?key[=:]\s*["']?[a-zA-Z0-9_-]+["']?/gi,
	// Bearer tokens
	/Bearer\s+[a-zA-Z0-9_.-]+/g,
	// GitHub tokens
	/gh[pousr]_[a-zA-Z0-9]+/g,
	/x-access-token:[^@]+@/g,
	// Modal tokens
	/ak-[a-zA-Z0-9_-]+/g,
	/as-[a-zA-Z0-9_-]+/g,
	// E2B API keys
	/e2b_[a-zA-Z0-9]+/gi,
	// JWT tokens (rough pattern)
	/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
	// Generic secrets in URLs
	/:[^:@\s]{20,}@/g,
];

/**
 * Redact sensitive information from error messages.
 */
export function redactSecrets(text: string): string {
	let redacted = text;
	for (const pattern of REDACT_PATTERNS) {
		redacted = redacted.replace(pattern, "[REDACTED]");
	}
	return redacted;
}

/**
 * Typed error for sandbox provider operations.
 *
 * Provides consistent error handling across providers with:
 * - Provider and operation context
 * - Retry eligibility flag
 * - Secret redaction
 * - Optional status code
 */
export class SandboxProviderError extends Error {
	readonly provider: SandboxProviderType;
	readonly operation: SandboxOperation;
	readonly statusCode?: number;
	readonly isRetryable: boolean;
	readonly raw?: unknown;

	constructor(options: {
		provider: SandboxProviderType;
		operation: SandboxOperation;
		message: string;
		statusCode?: number;
		isRetryable?: boolean;
		raw?: unknown;
		cause?: Error;
	}) {
		// Redact the message before storing
		const safeMessage = redactSecrets(options.message);

		super(`[${options.provider}:${options.operation}] ${safeMessage}`);
		this.name = "SandboxProviderError";
		this.provider = options.provider;
		this.operation = options.operation;
		this.statusCode = options.statusCode;
		this.isRetryable = options.isRetryable ?? false;
		this.raw = options.raw;

		if (options.cause) {
			this.cause = options.cause;
		}

		// Maintain proper prototype chain
		Object.setPrototypeOf(this, SandboxProviderError.prototype);
	}

	/**
	 * Create a SandboxProviderError from an HTTP response.
	 */
	static async fromResponse(
		response: Response,
		provider: SandboxProviderType,
		operation: SandboxOperation,
	): Promise<SandboxProviderError> {
		let message: string;
		let raw: unknown;

		// Read body as text first (can only read once)
		const text = await response.text();

		try {
			// Try to parse as JSON
			const json = JSON.parse(text) as Record<string, unknown>;
			raw = json;
			message =
				(json.error as string) ||
				(json.message as string) ||
				(json.detail as string) ||
				JSON.stringify(json);
		} catch {
			// Not JSON, use text directly
			raw = text;
			message = text.slice(0, 500); // Truncate long error messages
		}

		// Determine if retryable based on status code
		const isRetryable =
			response.status === 429 || // Rate limited
			response.status === 502 || // Bad gateway
			response.status === 503 || // Service unavailable
			response.status === 504; // Gateway timeout

		return new SandboxProviderError({
			provider,
			operation,
			message: `HTTP ${response.status}: ${message}`,
			statusCode: response.status,
			isRetryable,
			raw,
		});
	}

	/**
	 * Create a SandboxProviderError from a caught exception.
	 */
	static fromError(
		error: unknown,
		provider: SandboxProviderType,
		operation: SandboxOperation,
	): SandboxProviderError {
		if (error instanceof SandboxProviderError) {
			return error;
		}

		const message = error instanceof Error ? error.message : String(error);
		const cause = error instanceof Error ? error : undefined;

		// Network errors are typically retryable
		const isRetryable =
			message.includes("ECONNREFUSED") ||
			message.includes("ETIMEDOUT") ||
			message.includes("ENOTFOUND") ||
			message.includes("fetch failed") ||
			message.includes("network") ||
			message.includes("timeout");

		return new SandboxProviderError({
			provider,
			operation,
			message,
			isRetryable,
			raw: error,
			cause,
		});
	}
}

/**
 * Type guard to check if an error is a SandboxProviderError
 */
export function isSandboxProviderError(error: unknown): error is SandboxProviderError {
	return error instanceof SandboxProviderError;
}
