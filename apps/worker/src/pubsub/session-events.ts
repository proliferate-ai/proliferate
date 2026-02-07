/**
 * Session Subscriber
 *
 * Persistent Redis subscriber that listens for session events
 * and wakes async clients (like Slack) when messages arrive from other sources.
 */

import type { WakeableClient } from "@proliferate/gateway-clients/server";
import type { Logger } from "@proliferate/logger";
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
	private readonly logger: Logger;
	private readonly clients = new Map<ClientSource, WakeableClient>();
	private isRunning = false;

	constructor(redis: IORedis, logger: Logger) {
		this.redis = redis;
		this.logger = logger;
	}

	/**
	 * Register a client that can be woken when messages arrive from other sources.
	 */
	registerClient(client: WakeableClient): void {
		this.clients.set(client.clientType, client);
		this.logger.info({ clientType: client.clientType }, "Registered client");
	}

	/**
	 * Start listening for session events
	 */
	async start(): Promise<void> {
		if (this.isRunning) {
			return;
		}

		this.isRunning = true;
		this.logger.info({ channel: SESSION_EVENTS_CHANNEL }, "Starting, subscribing to channel");

		// Subscribe to the channel
		await this.redis.subscribe(SESSION_EVENTS_CHANNEL);

		// Handle messages
		this.redis.on("message", (channel, message) => {
			if (channel !== SESSION_EVENTS_CHANNEL) {
				return;
			}

			this.handleMessage(message).catch((err) => {
				this.logger.error({ err }, "Error handling message");
			});
		});

		this.logger.info("Started");
	}

	/**
	 * Stop listening and clean up
	 */
	async stop(): Promise<void> {
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;
		this.logger.info("Stopping");

		await this.redis.unsubscribe(SESSION_EVENTS_CHANNEL);
		this.logger.info("Stopped");
	}

	private async handleMessage(message: string): Promise<void> {
		let event: SessionEventMessage;
		try {
			event = JSON.parse(message) as SessionEventMessage;
		} catch {
			this.logger.warn({ message }, "Invalid JSON message");
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
			this.logger.warn({ clientType: session.clientType }, "No client registered for type");
			return;
		}

		this.logger.info(
			{ clientType: session.clientType, sessionId, source },
			"Waking client for session",
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
