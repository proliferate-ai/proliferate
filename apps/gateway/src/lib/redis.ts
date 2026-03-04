/**
 * Redis client for Gateway pubsub and coordination.
 */

import { env } from "@proliferate/environment/server";
import { createRedisClientManager } from "@proliferate/infra";
import { createLogger } from "@proliferate/logger";
import { SESSION_EVENTS_CHANNEL, type SessionEventMessage } from "@proliferate/shared";
import type IORedis from "ioredis";

const logger = createLogger({ service: "gateway" }).child({ module: "redis" });
const redisUrl = env.REDIS_URL;
if (!redisUrl) {
	throw new Error("REDIS_URL is required for gateway startup");
}
const redisManager = createRedisClientManager({
	redisUrl,
	onError: (err) => {
		logger.error({ err }, "Connection error");
	},
	onConnect: () => {
		logger.info("Connected");
	},
});

/**
 * Ensure Redis is connected (lazy connect on first use)
 */
export async function ensureRedisConnected(): Promise<IORedis> {
	try {
		return await redisManager.ensureConnected();
	} catch (err) {
		logger.error({ err }, "Failed to connect");
		throw err;
	}
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
		logger.error({ err }, "Failed to publish session event");
	}
}

/**
 * Close the Redis connection (for graceful shutdown)
 */
export async function closeRedisConnection(): Promise<void> {
	await redisManager.close();
}
