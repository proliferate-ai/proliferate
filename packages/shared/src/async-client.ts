/**
 * Async Client System
 *
 * Enables non-WebSocket clients (like Slack) to receive session events
 * even when the message originates from a different source (e.g., web UI).
 */

import type { ClientSource } from "./index";

/**
 * Redis pubsub channel for session events
 */
export const SESSION_EVENTS_CHANNEL = "session:events";

/**
 * Message published to Redis when a user sends a message to a session
 */
export interface SessionEventMessage {
	type: "user_message";
	sessionId: string;
	source: ClientSource;
	timestamp: number;
	/** The user message content - used to post to async clients immediately */
	content: string;
	/** User ID who sent the message */
	userId?: string;
}

/**
 * Options passed to wake() when a user message triggers the wakeup
 */
export interface WakeOptions {
	/** The user message content */
	content: string;
	/** User ID who sent the message */
	userId?: string;
}

/**
 * Interface for async clients that need to be woken up when session events occur.
 *
 * Async clients are clients that don't maintain a persistent WebSocket connection
 * but need to receive session events (like Slack posting responses to threads).
 *
 * @template TMetadata - The type of client metadata stored in sessions.client_metadata
 */
export interface AsyncClient<TMetadata = unknown> {
	/**
	 * Unique identifier for this client type.
	 * Must match the value stored in sessions.client_type
	 */
	readonly clientType: string;

	/**
	 * Wake this client for a session event.
	 *
	 * This method should be idempotent - safe to call multiple times for the same event.
	 * Implementations should use BullMQ job deduplication or similar mechanisms.
	 *
	 * @param sessionId - The session ID that received the event
	 * @param metadata - Client-specific metadata from sessions.client_metadata
	 * @param source - Where the event originated (web, slack, api)
	 * @param options - Optional message content and userId for immediate posting
	 */
	wake(
		sessionId: string,
		metadata: TMetadata,
		source: ClientSource,
		options?: WakeOptions,
	): Promise<void>;
}
