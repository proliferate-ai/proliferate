/**
 * Async Receiver
 *
 * WebSocket receiver for async clients.
 */

import type { AsyncClient } from "./index";
import type { ReceiverOptions } from "./types";

const DEFAULT_CONNECT_TIMEOUT_MS = 30000;

/**
 * Run a WebSocket receiver for an async client
 *
 * Connects to the Gateway and routes events through client.handleEvent().
 * Closes when handleEvent returns "stop".
 */
export async function runReceiver<TMetadata>(
	client: AsyncClient<TMetadata>,
	proliferateSessionId: string,
	metadata: TMetadata,
	options?: ReceiverOptions,
): Promise<void> {
	const connectTimeoutMs = options?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

	return new Promise<void>((resolve, reject) => {
		let connectTimeout: NodeJS.Timeout | null = setTimeout(() => {
			connectTimeout = null;
			console.error(`[Receiver] Connection timeout for session ${proliferateSessionId}`);
			ws.close();
			reject(new Error("WebSocket connection timeout"));
		}, connectTimeoutMs);

		const ws = client.syncClient.connect(proliferateSessionId, {
			onEvent: async (event) => {
				let action: "continue" | "stop";
				try {
					action = await client.handleEvent(proliferateSessionId, metadata, event);
				} catch (err) {
					console.error(`[Receiver] handleEvent error for session ${proliferateSessionId}:`, err);
					action = "continue"; // Don't stop on handler errors
				}

				if (action === "stop") {
					ws.close();
					resolve();
				}
			},

			onOpen: () => {
				if (connectTimeout) {
					clearTimeout(connectTimeout);
					connectTimeout = null;
				}
				console.log(`[Receiver] Connected for session ${proliferateSessionId}`);
				options?.onOpen?.();
			},

			onClose: (code, reason) => {
				console.log(
					`[Receiver] Closed for session ${proliferateSessionId}: ${code} - ${reason || "no reason"}`,
				);
				options?.onClose?.(code, reason);
				resolve();
			},

			onReconnect: (attempt) => {
				console.log(
					`[Receiver] Reconnecting for session ${proliferateSessionId} (attempt ${attempt})...`,
				);
				options?.onReconnect?.(attempt);
			},

			onReconnectFailed: () => {
				console.error(`[Receiver] Reconnection failed for session ${proliferateSessionId}`);
				options?.onReconnectFailed?.();
				reject(new Error("WebSocket reconnection failed"));
			},
		});
	});
}
