/**
 * OpenCode bridge — B2: subscribe to local OpenCode SSE and normalize events.
 *
 * Connects to OpenCode's local SSE endpoint at 127.0.0.1:4096/event,
 * waits for server.connected handshake, then normalizes all events
 * into RuntimeDaemonEvent envelopes and pushes them through the EventBus.
 *
 * Never exposes raw OpenCode endpoints externally.
 */

import type { Logger } from "@proliferate/logger";
import type { RuntimeDaemonEvent } from "@proliferate/shared/contracts";
import {
	OPENCODE_HANDSHAKE_TIMEOUT_MS,
	OPENCODE_HOST,
	OPENCODE_MAX_RECONNECT_ATTEMPTS,
	OPENCODE_PORT,
	OPENCODE_RECONNECT_DELAY_MS,
} from "./config.js";
import type { EventBus } from "./event-bus.js";

// ---------------------------------------------------------------------------
// OpenCode SSE event shape (mirrors gateway types.ts)
// ---------------------------------------------------------------------------

interface OpenCodeEvent {
	type: string;
	properties: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Event normalization
// ---------------------------------------------------------------------------

function resolveChannel(eventType: string): RuntimeDaemonEvent["channel"] {
	if (eventType.startsWith("message.")) return "message";
	if (eventType.startsWith("session.")) return "session";
	return "server";
}

function isTerminalEvent(eventType: string): boolean {
	return eventType === "session.error";
}

function normalizeEvent(event: OpenCodeEvent): RuntimeDaemonEvent {
	return {
		source: "daemon",
		channel: resolveChannel(event.type),
		type: event.type,
		isTerminal: isTerminalEvent(event.type),
		occurredAt: new Date().toISOString(),
		payload: event,
	};
}

// ---------------------------------------------------------------------------
// SSE line parser (minimal, no external dependencies)
// ---------------------------------------------------------------------------

function parseSseLine(buffer: string, onEvent: (data: string) => void): string {
	let remaining = buffer;
	let nlIdx = remaining.indexOf("\n\n");
	while (nlIdx !== -1) {
		const block = remaining.slice(0, nlIdx);
		remaining = remaining.slice(nlIdx + 2);

		let data = "";
		for (const line of block.split("\n")) {
			if (line.startsWith("data: ")) {
				data += line.slice(6);
			} else if (line.startsWith("data:")) {
				data += line.slice(5);
			}
		}
		if (data) {
			onEvent(data);
		}
		nlIdx = remaining.indexOf("\n\n");
	}
	return remaining;
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export interface OpenCodeBridgeOptions {
	eventBus: EventBus;
	logger: Logger;
	host?: string;
	port?: number;
}

export class OpenCodeBridge {
	private readonly eventBus: EventBus;
	private readonly logger: Logger;
	private readonly host: string;
	private readonly port: number;

	private abortController: AbortController | null = null;
	private connected = false;
	private handshakeReceived = false;
	private reconnectAttempts = 0;
	private stopped = false;

	constructor(options: OpenCodeBridgeOptions) {
		this.eventBus = options.eventBus;
		this.logger = options.logger.child({ module: "opencode-bridge" });
		this.host = options.host ?? OPENCODE_HOST;
		this.port = options.port ?? OPENCODE_PORT;
	}

	/**
	 * Start the bridge. Connects to OpenCode SSE and begins event forwarding.
	 * Resolves once the server.connected handshake is received, or rejects
	 * on timeout.
	 */
	async start(): Promise<void> {
		this.stopped = false;
		this.reconnectAttempts = 0;
		await this.connectWithHandshake();
	}

	/**
	 * Stop the bridge. Disconnects from OpenCode SSE.
	 */
	stop(): void {
		this.stopped = true;
		this.disconnect();
	}

	isConnected(): boolean {
		return this.connected && this.handshakeReceived;
	}

	// -----------------------------------------------------------------------
	// Internal
	// -----------------------------------------------------------------------

	private disconnect(): void {
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
		this.connected = false;
	}

	private async connectWithHandshake(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.disconnect();
				reject(new Error("OpenCode handshake timeout"));
			}, OPENCODE_HANDSHAKE_TIMEOUT_MS);

			let handshakeResolved = false;

			this.doConnect((event) => {
				if (event.type === "server.connected" && !handshakeResolved) {
					handshakeResolved = true;
					this.handshakeReceived = true;
					clearTimeout(timeout);
					this.logger.info("OpenCode handshake received");
					this.eventBus.emitSystemEvent({ type: "opencode_connected" });
					resolve();
				}
			}).catch((err) => {
				clearTimeout(timeout);
				if (!handshakeResolved) {
					reject(err);
				}
			});
		});
	}

	private async doConnect(onFirstEvent?: (event: OpenCodeEvent) => void): Promise<void> {
		this.disconnect();

		const controller = new AbortController();
		this.abortController = controller;
		const url = `http://${this.host}:${this.port}/event`;
		this.logger.info({ url }, "Connecting to OpenCode SSE");

		let response: Response;
		try {
			response = await fetch(url, {
				headers: { Accept: "text/event-stream" },
				signal: controller.signal,
			});
		} catch (err) {
			this.connected = false;
			throw new Error(
				`Failed to connect to OpenCode at ${url}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}

		if (!response.ok || !response.body) {
			this.connected = false;
			throw new Error(`OpenCode SSE returned ${response.status}`);
		}

		this.connected = true;
		this.reconnectAttempts = 0;
		this.logger.info("OpenCode SSE stream connected");

		// Read stream in background
		this.readStream(response.body, controller, onFirstEvent);
	}

	private readStream(
		body: ReadableStream<Uint8Array>,
		controller: AbortController,
		onFirstEvent?: (event: OpenCodeEvent) => void,
	): void {
		const decoder = new TextDecoder();
		const reader = body.getReader();
		let buffer = "";

		const readLoop = async () => {
			try {
				while (!controller.signal.aborted) {
					const { done, value } = await reader.read();
					if (done) break;
					if (!value) continue;

					buffer += decoder.decode(value, { stream: true });
					buffer = parseSseLine(buffer, (data) => {
						try {
							const event = JSON.parse(data) as OpenCodeEvent;
							if (onFirstEvent) {
								onFirstEvent(event);
							}
							this.handleEvent(event);
						} catch {
							this.logger.warn({ data: data.slice(0, 200) }, "Invalid JSON in SSE data");
						}
					});
				}
			} catch (err) {
				if (controller.signal.aborted) return;
				this.logger.error({ err }, "OpenCode SSE stream error");
			} finally {
				reader.releaseLock();
			}

			this.connected = false;
			this.handshakeReceived = false;

			if (!this.stopped) {
				this.scheduleReconnect();
			}
		};

		readLoop().catch((err) => {
			this.logger.error({ err }, "OpenCode SSE read loop failed");
		});
	}

	private handleEvent(event: OpenCodeEvent): void {
		// Skip transport-level events from forwarding (but still track them)
		if (event.type === "server.heartbeat") {
			return;
		}

		const normalized = normalizeEvent(event);
		this.eventBus.emitAgentEvent(normalized);
	}

	private scheduleReconnect(): void {
		if (this.stopped) return;

		this.reconnectAttempts++;
		if (
			OPENCODE_MAX_RECONNECT_ATTEMPTS > 0 &&
			this.reconnectAttempts > OPENCODE_MAX_RECONNECT_ATTEMPTS
		) {
			this.logger.error(
				{ attempts: this.reconnectAttempts },
				"Max OpenCode reconnect attempts reached",
			);
			this.eventBus.emitSystemEvent({ type: "opencode_disconnected", permanent: true });
			return;
		}

		const delay = Math.min(OPENCODE_RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1), 30_000);
		this.logger.info(
			{ attempt: this.reconnectAttempts, delayMs: delay },
			"Scheduling OpenCode reconnect",
		);

		setTimeout(() => {
			if (this.stopped) return;
			this.doConnect().catch((err) => {
				this.logger.error({ err }, "OpenCode reconnect failed");
				this.scheduleReconnect();
			});
		}, delay);
	}
}
