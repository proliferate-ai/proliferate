/**
 * Fetch Utilities for Sandbox Providers
 *
 * Provides timeout-enabled fetch wrapper for reliable HTTP calls.
 */

import { type SandboxOperation, SandboxProviderError, type SandboxProviderType } from "./errors";

export interface FetchWithTimeoutOptions extends RequestInit {
	/** Timeout in milliseconds. Default: 30000 (30s) */
	timeoutMs?: number;
}

/**
 * Fetch with automatic timeout and abort signal handling.
 *
 * Wraps native fetch with:
 * - Configurable timeout (default 30s)
 * - Automatic AbortController management
 * - Proper error handling for timeout vs network errors
 */
export async function fetchWithTimeout(
	url: string,
	options: FetchWithTimeoutOptions = {},
): Promise<Response> {
	const { timeoutMs = 30000, signal: externalSignal, ...fetchOptions } = options;

	// Create abort controller for timeout
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	// Combine with any external signal
	if (externalSignal) {
		externalSignal.addEventListener("abort", () => controller.abort());
	}

	try {
		const response = await fetch(url, {
			...fetchOptions,
			signal: controller.signal,
		});
		return response;
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`);
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Fetch wrapper for sandbox provider operations.
 *
 * Provides consistent error handling with SandboxProviderError:
 * - Automatic timeout handling
 * - HTTP error response conversion
 * - Secret redaction in errors
 */
export async function providerFetch(
	url: string,
	options: FetchWithTimeoutOptions & {
		provider: SandboxProviderType;
		operation: SandboxOperation;
	},
): Promise<Response> {
	const { provider, operation, ...fetchOptions } = options;

	try {
		const response = await fetchWithTimeout(url, fetchOptions);

		if (!response.ok) {
			throw await SandboxProviderError.fromResponse(response, provider, operation);
		}

		return response;
	} catch (error) {
		if (error instanceof SandboxProviderError) {
			throw error;
		}
		throw SandboxProviderError.fromError(error, provider, operation);
	}
}

/**
 * Default timeout values for different operations.
 *
 * These are conservative defaults that should work in most cases.
 * Adjust based on observed latencies.
 */
export const DEFAULT_TIMEOUTS = {
	/** Creating a sandbox can take 2-3 minutes for clone + setup */
	createSandbox: 180000, // 3 minutes
	/** Snapshots may take time for large filesystems */
	snapshot: 120000, // 2 minutes
	/** Termination should be fast */
	terminate: 30000, // 30 seconds
	/** Writing env file should be quick */
	writeEnvFile: 30000, // 30 seconds
	/** Health check should be fast */
	health: 10000, // 10 seconds
	/** Checking sandbox status */
	checkSandboxes: 30000, // 30 seconds
} as const;
