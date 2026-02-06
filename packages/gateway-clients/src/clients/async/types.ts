/**
 * AsyncClient Types
 *
 * Types specific to the async (BullMQ-based) client.
 */

import type { Database } from "@proliferate/db";
import type { ConnectionOptions as BullMQConnectionOptions, JobsOptions } from "bullmq";
import type { SyncClient } from "../sync";

/**
 * Dependencies for AsyncClient
 */
export interface AsyncClientDeps {
	/** SyncClient for gateway communication */
	syncClient: SyncClient;
	/** Drizzle database client */
	db: Database;
}

/**
 * Options for AsyncClient.setup()
 */
export interface AsyncClientSetupOptions {
	/** BullMQ connection options */
	connection: BullMQConnectionOptions;
	/** Concurrency for inbound worker (default: 5) */
	inboundConcurrency?: number;
	/** Concurrency for receiver worker (default: 10) */
	receiverConcurrency?: number;
	/** Job options for inbound queue */
	inboundJobOptions?: JobsOptions;
	/** Job options for receiver queue */
	receiverJobOptions?: JobsOptions;
}

/**
 * Options for running a receiver
 */
export interface ReceiverOptions {
	/** Connection timeout in milliseconds (default: 30000) */
	connectTimeoutMs?: number;
	/** Called when connection is established */
	onOpen?: () => void;
	/** Called when connection closes */
	onClose?: (code: number, reason?: string) => void;
	/** Called on reconnection attempt */
	onReconnect?: (attempt: number) => void;
	/** Called when all reconnection attempts fail */
	onReconnectFailed?: () => void;
}
