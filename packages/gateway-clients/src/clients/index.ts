/**
 * Client Exports (Browser-safe)
 *
 * For server-only exports (AsyncClient, etc.), use "@proliferate/gateway-clients/server"
 */

// SyncClient
export {
	createSyncClient,
	type SyncClient,
	type SyncClientOptions,
	type SyncWebSocket,
	type WebSocketOptions,
	type ConnectionOptions,
} from "./sync";

// ExternalClient
export {
	type ExternalClient,
	type ExternalClientOptions,
	OpenCodeClient,
	createOpenCodeClient,
	type OpenCodeClientOptions,
} from "./external";
