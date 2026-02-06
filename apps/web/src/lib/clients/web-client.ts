/**
 * Web Client
 *
 * Re-exports SyncClient for web usage.
 * The SyncClient from gateway-sdk is used directly - no wrapper needed.
 */

export {
	createSyncClient as createWebClient,
	type SyncClient as WebClient,
} from "@proliferate/gateway-clients";
