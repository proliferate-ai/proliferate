/**
 * SSE Client
 *
 * Transport-only class for SSE connection to OpenCode server.
 * Connects, reads events, reports disconnects. Does NOT manage reconnection.
 * SessionHub owns reconnection logic.
 */

import { createParser } from "eventsource-parser";
import type { GatewayEnv } from "../lib/env";
import type { OpenCodeEvent } from "../types";

export interface SseClientOptions {
	onEvent: (event: OpenCodeEvent) => void;
	onDisconnect: (reason: string) => void;
	env: GatewayEnv;
}

export class SseClient {
	private abortController: AbortController | null = null;
	private connected = false;
	private connectingPromise: Promise<void> | null = null;
	private lastEventTime = 0;
	private heartbeatInterval: NodeJS.Timeout | null = null;
	private currentUrl: string | null = null;
	private connectStartTime = 0;

	constructor(private readonly options: SseClientOptions) {}

	/**
	 * Connect to the SSE stream at the given URL.
	 * Throws on failure - caller (SessionHub) handles reconnection.
	 */
	async connect(url: string): Promise<void> {
		if (this.connected) {
			return;
		}

		if (this.connectingPromise) {
			return this.connectingPromise;
		}

		this.connectingPromise = this.doConnect(url);
		try {
			await this.connectingPromise;
		} finally {
			this.connectingPromise = null;
		}
	}

	/**
	 * Disconnect from the SSE stream.
	 */
	disconnect(): void {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
		this.connected = false;
		this.connectingPromise = null;
	}

	/**
	 * Check if currently connected.
	 */
	isConnected(): boolean {
		return this.connected;
	}

	private async doConnect(url: string): Promise<void> {
		if (this.abortController) {
			this.abortController.abort();
		}

		const controller = new AbortController();
		this.abortController = controller;
		const sseUrl = `${url}/event`;
		this.currentUrl = sseUrl;
		this.connectStartTime = Date.now();

		const response = await fetch(sseUrl, {
			headers: { Accept: "text/event-stream" },
			signal: controller.signal,
		});

		if (!response.ok || !response.body) {
			throw new Error(`SSE connection failed: ${response.status}`);
		}

		this.connected = true;
		this.lastEventTime = Date.now();
		this.startHeartbeatMonitor();

		// Start reading stream in background
		this.readStream(response.body, controller);
	}

	private readStream(body: ReadableStream<Uint8Array>, controller: AbortController): void {
		const decoder = new TextDecoder();
		const parser = createParser({
			onEvent: (event) => {
				if (!event.data) {
					return;
				}
				try {
					const parsed = JSON.parse(event.data) as OpenCodeEvent;
					this.lastEventTime = Date.now();
					this.options.onEvent(parsed);
				} catch (err) {
					console.warn("[SseClient] Invalid JSON payload", err);
				}
			},
		});

		const reader = body.getReader();
		const readLoop = async () => {
			try {
				while (true) {
					const { done, value } = await this.readWithTimeout(
						reader,
						this.options.env.sseReadTimeoutMs,
					);
					if (done) {
						break;
					}
					if (!value) {
						continue;
					}
					this.lastEventTime = Date.now();
					const chunk = decoder.decode(value, { stream: true });
					parser.feed(chunk);
				}
			} catch (err) {
				if (controller.signal.aborted) {
					return;
				}
				const errorInfo = this.buildErrorInfo(err, controller);
				if (isStreamTerminationError(err)) {
					console.warn("[SseClient] Stream closed", errorInfo);
					this.handleDisconnect("stream_closed");
					return;
				}
				console.error("[SseClient] Stream error", errorInfo, err);
				this.handleDisconnect("stream_error");
				return;
			} finally {
				reader.releaseLock();
			}

			if (controller.signal.aborted) {
				return;
			}
			console.warn("[SseClient] Stream ended", this.buildErrorInfo(null, controller));
			this.handleDisconnect("stream_closed");
		};

		readLoop().catch((err) => {
			console.error("[SseClient] Read loop error", err);
		});
	}

	private async readWithTimeout(
		reader: ReadableStreamDefaultReader<Uint8Array>,
		timeoutMs: number,
	): Promise<ReadableStreamReadResult<Uint8Array>> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("SSE_READ_TIMEOUT"));
			}, timeoutMs);

			reader
				.read()
				.then((result) => {
					clearTimeout(timeout);
					resolve(result);
				})
				.catch((err) => {
					clearTimeout(timeout);
					reject(err);
				});
		});
	}

	private startHeartbeatMonitor(): void {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
		}

		// Check more frequently than the timeout (every 1/3 of timeout)
		const checkInterval = Math.max(5000, Math.floor(this.options.env.heartbeatTimeoutMs / 3));

		this.heartbeatInterval = setInterval(() => {
			const timeSinceLastEvent = Date.now() - this.lastEventTime;
			if (this.connected && timeSinceLastEvent > this.options.env.heartbeatTimeoutMs) {
				console.error(`[SseClient] Heartbeat timeout after ${timeSinceLastEvent}ms`);
				this.handleDisconnect("heartbeat_timeout");
			}
		}, checkInterval);
	}

	private handleDisconnect(reason: string): void {
		this.connected = false;
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}
		this.options.onDisconnect(reason);
	}

	private buildErrorInfo(err: unknown, controller: AbortController): Record<string, unknown> {
		const cause =
			err instanceof Error
				? (err.cause as { code?: string; message?: string; socket?: unknown } | undefined)
				: undefined;
		const socketInfo = extractSocketInfo(cause?.socket);
		const now = Date.now();
		return {
			url: this.currentUrl,
			connected: this.connected,
			aborted: controller.signal.aborted,
			timeSinceConnectMs: this.connectStartTime ? now - this.connectStartTime : null,
			timeSinceLastEventMs: this.lastEventTime ? now - this.lastEventTime : null,
			errorName: err instanceof Error ? err.name : undefined,
			errorMessage: err instanceof Error ? err.message : undefined,
			causeCode: cause?.code,
			causeMessage: cause?.message,
			socket: socketInfo || undefined,
		};
	}
}

function isStreamTerminationError(err: unknown): boolean {
	if (err instanceof Error) {
		if (err.name === "AbortError") {
			return true;
		}
		if (err.message === "terminated") {
			return true;
		}
		const cause = err.cause as { code?: string } | undefined;
		if (cause?.code === "UND_ERR_SOCKET") {
			return true;
		}
	}
	return false;
}

function extractSocketInfo(socket: unknown): Record<string, unknown> | null {
	if (!socket || typeof socket !== "object") {
		return null;
	}
	const typed = socket as {
		localAddress?: string;
		localPort?: number;
		remoteAddress?: string;
		remotePort?: number;
		remoteFamily?: string;
	};
	const info: Record<string, unknown> = {};
	if (typed.localAddress) info.localAddress = typed.localAddress;
	if (typed.localPort) info.localPort = typed.localPort;
	if (typed.remoteAddress) info.remoteAddress = typed.remoteAddress;
	if (typed.remotePort) info.remotePort = typed.remotePort;
	if (typed.remoteFamily) info.remoteFamily = typed.remoteFamily;
	return Object.keys(info).length > 0 ? info : null;
}
