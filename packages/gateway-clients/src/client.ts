/**
 * Base Client Interface
 *
 * All clients (Sync, Async, External) implement this interface
 * for shared capabilities and type discrimination.
 */

import type { HealthCheckResult, VerificationFile } from "./types";

/**
 * Verification tools - available on all client types
 */
export interface VerificationTools {
	/**
	 * List verification files under a prefix
	 */
	list(proliferateSessionId: string, options?: { prefix?: string }): Promise<VerificationFile[]>;

	/**
	 * Get a presigned URL for a verification file
	 */
	getUrl(proliferateSessionId: string, key: string): Promise<string>;

	/**
	 * Get a verification file as an ArrayBuffer
	 */
	getStream(
		proliferateSessionId: string,
		key: string,
	): Promise<{ data: ArrayBuffer; contentType: string }>;
}

/**
 * Client capabilities - tools available on all client types
 */
export interface ClientTools {
	verification: VerificationTools;
}

/**
 * Base client interface implemented by all client types
 */
export interface Client {
	readonly type: "sync" | "async" | "external";

	/**
	 * Health check - verify gateway is reachable
	 */
	checkHealth(): Promise<HealthCheckResult>;

	/**
	 * Capabilities - methods available on all client types
	 */
	readonly tools: ClientTools;
}

/**
 * Type guard for sync clients
 */
export function isSyncClient(client: Client): client is Client & { type: "sync" } {
	return client.type === "sync";
}

/**
 * Type guard for async clients
 */
export function isAsyncClient(client: Client): client is Client & { type: "async" } {
	return client.type === "async";
}

/**
 * Type guard for external clients
 */
export function isExternalClient(client: Client): client is Client & { type: "external" } {
	return client.type === "external";
}
