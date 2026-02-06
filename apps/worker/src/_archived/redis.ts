/**
 * Redis State Helpers
 *
 * Manages polling state in Redis for fast access.
 * State is also backed up to Supabase for durability.
 */

import { REDIS_KEYS, getRedisClient } from "@proliferate/queue";
import type { PollState } from "@proliferate/shared";

const POLL_LOCK_TTL = 120; // 2 minutes

/**
 * Get polling state from Redis, or null if not found
 */
export async function getPollState(triggerId: string): Promise<PollState | null> {
	const redis = getRedisClient();
	const key = REDIS_KEYS.pollState(triggerId);

	const data = await redis.get(key);
	if (!data) return null;

	try {
		return JSON.parse(data) as PollState;
	} catch {
		return null;
	}
}

/**
 * Save polling state to Redis
 */
export async function setPollState(triggerId: string, state: PollState): Promise<void> {
	const redis = getRedisClient();
	const key = REDIS_KEYS.pollState(triggerId);

	await redis.set(key, JSON.stringify(state));
}

/**
 * Delete polling state from Redis
 */
export async function deletePollState(triggerId: string): Promise<void> {
	const redis = getRedisClient();
	const key = REDIS_KEYS.pollState(triggerId);

	await redis.del(key);
}

/**
 * Acquire a lock for polling execution.
 * Returns true if lock was acquired, false if already held.
 */
export async function acquirePollLock(triggerId: string): Promise<boolean> {
	const redis = getRedisClient();
	const key = REDIS_KEYS.pollLock(triggerId);

	// SET NX (only if not exists) with EX (expire after TTL seconds)
	const result = await redis.set(key, Date.now().toString(), "EX", POLL_LOCK_TTL, "NX");

	return result === "OK";
}

/**
 * Release a polling lock
 */
export async function releasePollLock(triggerId: string): Promise<void> {
	const redis = getRedisClient();
	const key = REDIS_KEYS.pollLock(triggerId);

	await redis.del(key);
}

/**
 * Extend a polling lock's TTL (for long-running polls)
 */
export async function extendPollLock(triggerId: string): Promise<void> {
	const redis = getRedisClient();
	const key = REDIS_KEYS.pollLock(triggerId);

	await redis.expire(key, POLL_LOCK_TTL);
}
