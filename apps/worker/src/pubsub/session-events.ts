/**
 * Session Subscriber
 *
 * Persistent Redis subscriber that listens for session events
 * and wakes async clients (like Slack) when messages arrive from other sources.
 */

import type { WakeableClient } from "@proliferate/gateway-clients/server";
import { sessions } from "@proliferate/services";
import {
	type ClientSource,
	SESSION_EVENTS_CHANNEL,
	type SessionEventMessage,
	type WakeOptions,
} from "@proliferate/shared";
import type IORedis from "ioredis";

export class SessionSubscriber {
	private readonly redis: IORedis;
	private readonly clients = new Map<ClientSource, WakeableClient>();
	private isRunning = false;

	constructor(redis: IORedis) {
		this.redis = redis;
	}

	/**
	 * Register a client that can be woken when messages arrive from other sources.
	 */
	registerClient(client: WakeableClient): void {
		this.clients.set(client.clientType, client);
		console.log(`[SessionSubscriber] Registered client: ${client.clientType}`);
	}

	/**
	 * Start listening for session events
	 */
	async start(): Promise<void> {
		if (this.isRunning) {
			return;
		}

		this.isRunning = true;
		console.log(`[SessionSubscriber] Starting, subscribing to ${SESSION_EVENTS_CHANNEL}`);

		// Subscribe to the channel
		await this.redis.subscribe(SESSION_EVENTS_CHANNEL);

		// Handle messages
		this.redis.on("message", (channel, message) => {
			if (channel !== SESSION_EVENTS_CHANNEL) {
				return;
			}

			this.handleMessage(message).catch((err) => {
				console.error("[SessionSubscriber] Error handling message:", err);
			});
		});

		console.log("[SessionSubscriber] Started");
	}

	/**
	 * Stop listening and clean up
	 */
	async stop(): Promise<void> {
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;
		console.log("[SessionSubscriber] Stopping...");

		await this.redis.unsubscribe(SESSION_EVENTS_CHANNEL);
		console.log("[SessionSubscriber] Stopped");
	}

	private async handleMessage(message: string): Promise<void> {
		let event: SessionEventMessage;
		try {
			event = JSON.parse(message) as SessionEventMessage;
		} catch {
			console.warn("[SessionSubscriber] Invalid JSON message:", message);
			return;
		}

		if (event.type !== "user_message") {
			return;
		}

		const { sessionId, source } = event;

		// Look up the session to get client info
		const session = await sessions.getSessionClientInfo(sessionId);
		if (!session?.clientType) {
			// Session has no async client - nothing to do
			return;
		}

		// Find the registered client for this type
		const client = this.clients.get(session.clientType);
		if (!client) {
			console.warn(`[SessionSubscriber] No client registered for type: ${session.clientType}`);
			return;
		}

		console.log(
			`[SessionSubscriber] Waking ${session.clientType} client for session ${sessionId} (source: ${source})`,
		);

		// Build wake options with message content
		const wakeOptions: WakeOptions = {
			content: event.content,
			userId: event.userId,
		};

		// Wake the client - it handles idempotency internally
		await client.wake(sessionId, session.clientMetadata, source, wakeOptions);
	}
}
