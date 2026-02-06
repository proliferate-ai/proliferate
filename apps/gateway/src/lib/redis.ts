/**
 * Redis client for Gateway pubsub and coordination.
 */

import { env } from "@proliferate/environment/server";
import { SESSION_EVENTS_CHANNEL, type SessionEventMessage } from "@proliferate/shared";
import type IORedis from "ioredis";

let redisClient: IORedis | null = null;
let connectionPromise: Promise<void> | null = null;

/**
 * Get or create the Redis client.
 * Lazy connection - connects on first use.
 */
async function getRedisClient(): Promise<IORedis> {
	const redisUrl = env.REDIS_URL;
	if (!redisUrl) {
		throw new Error("REDIS_URL is required for gateway startup");
	}

	if (!redisClient) {
		// Dynamic import to avoid issues if ioredis is not installed
		const { default: IORedis } = await import("ioredis");
		redisClient = new IORedis(redisUrl, {
			maxRetriesPerRequest: 3,
			enableReadyCheck: true,
			lazyConnect: true,
		});

		redisClient.on("error", (err: Error) => {
			console.error("[Redis] Connection error:", err.message);
		});

		redisClient.on("connect", () => {
			console.log("[Redis] Connected");
		});
	}

	return redisClient;
}

/**
 * Ensure Redis is connected (lazy connect on first use)
 */
export async function ensureRedisConnected(): Promise<IORedis> {
	const client = await getRedisClient();

	// Check if already connected (status is "ready" when connected)
	const status = client.status as string;
	if (status === "ready") {
		return client;
	}

	if (!connectionPromise) {
		connectionPromise = client.connect().catch((err: Error) => {
			console.error("[Redis] Failed to connect:", err.message);
			connectionPromise = null;
		});
	}

	await connectionPromise;
	// Re-check status after connection attempt
	if ((client.status as string) !== "ready") {
		throw new Error("Redis connection not ready");
	}
	return client;
}

/**
 * Publish a session event to Redis for async clients.
 *
 * This is fire-and-forget - errors are logged but don't break the prompt flow.
 *
 * @param event - The session event to publish
 */
export async function publishSessionEvent(event: SessionEventMessage): Promise<void> {
	try {
		const client = await ensureRedisConnected();
		await client.publish(SESSION_EVENTS_CHANNEL, JSON.stringify(event));
	} catch (err) {
		// Log but don't throw - this is non-critical
		console.error(
			"[Redis] Failed to publish session event:",
			err instanceof Error ? err.message : err,
		);
	}
}

/**
 * Close the Redis connection (for graceful shutdown)
 */
export async function closeRedisConnection(): Promise<void> {
	if (redisClient) {
		await redisClient.quit();
		redisClient = null;
		connectionPromise = null;
	}
}
