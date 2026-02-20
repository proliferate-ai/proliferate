/**
 * Base Client Interface
 *
 * All clients (Sync, Async, External) implement this interface
 * for shared capabilities and type discrimination.
 */

import type { HealthCheckResult } from "./types";

/**
 * Client capabilities - tools available on all client types
 */
// biome-ignore lint/suspicious/noEmptyInterface: will be extended when new capabilities are added
export interface ClientTools {}

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
