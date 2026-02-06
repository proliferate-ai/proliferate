/**
 * Distributed locking for billing operations.
 *
 * Uses Redis SET NX with token-based ownership for safe acquire/renew/release.
 * This ensures only one metering worker processes billing at a time.
 */

import type IORedis from "ioredis";

// ============================================
// Lock Operations
// ============================================

/**
 * Acquire a distributed lock with unique token.
 *
 * @param redis - Redis client
 * @param key - Lock key
 * @param token - Unique token for this lock holder (use crypto.randomUUID())
 * @param ttlMs - Lock TTL in milliseconds
 * @returns true if lock acquired, false if already held
 */
export async function acquireLock(
	redis: IORedis,
	key: string,
	token: string,
	ttlMs: number,
): Promise<boolean> {
	const result = await redis.set(key, token, "PX", ttlMs, "NX");
	return result === "OK";
}

/**
 * Renew a lock's TTL if we still own it.
 * Uses Lua script for atomic check-and-extend.
 *
 * @param redis - Redis client
 * @param key - Lock key
 * @param token - Token used when acquiring the lock
 * @param ttlMs - New TTL in milliseconds
 * @returns true if renewed, false if lock lost
 */
export async function renewLock(
	redis: IORedis,
	key: string,
	token: string,
	ttlMs: number,
): Promise<boolean> {
	const script = `
		if redis.call("get", KEYS[1]) == ARGV[1] then
			return redis.call("pexpire", KEYS[1], ARGV[2])
		else
			return 0
		end
	`;
	const result = await redis.eval(script, 1, key, token, ttlMs);
	return result === 1;
}

/**
 * Release a lock if we still own it.
 * Uses Lua script for atomic check-and-delete.
 *
 * @param redis - Redis client
 * @param key - Lock key
 * @param token - Token used when acquiring the lock
 */
export async function releaseLock(redis: IORedis, key: string, token: string): Promise<void> {
	const script = `
		if redis.call("get", KEYS[1]) == ARGV[1] then
			return redis.call("del", KEYS[1])
		else
			return 0
		end
	`;
	await redis.eval(script, 1, key, token);
}

// ============================================
// Lock Helper
// ============================================

/**
 * Execute a function while holding a lock, with automatic renewal.
 *
 * @param redis - Redis client
 * @param key - Lock key
 * @param ttlMs - Lock TTL in milliseconds
 * @param renewIntervalMs - How often to renew the lock
 * @param fn - Function to execute while holding the lock
 * @returns Result of fn, or undefined if lock not acquired
 */
export async function withLock<T>(
	redis: IORedis,
	key: string,
	ttlMs: number,
	renewIntervalMs: number,
	fn: () => Promise<T>,
): Promise<T | undefined> {
	const token = crypto.randomUUID();

	// Try to acquire lock
	const acquired = await acquireLock(redis, key, token, ttlMs);
	if (!acquired) {
		return undefined;
	}

	// Set up renewal interval
	const renewInterval = setInterval(async () => {
		const renewed = await renewLock(redis, key, token, ttlMs);
		if (!renewed) {
			// Lost the lock somehow, clear interval
			clearInterval(renewInterval);
		}
	}, renewIntervalMs);

	try {
		return await fn();
	} finally {
		clearInterval(renewInterval);
		await releaseLock(redis, key, token);
	}
}

// ============================================
// Redis Keys for Billing
// ============================================

export const BILLING_REDIS_KEYS = {
	/**
	 * Metering worker lock.
	 * Only one worker should run metering at a time.
	 */
	meteringLock: "billing:metering:lock",

	/**
	 * Outbox worker lock.
	 * Only one worker should process the outbox at a time.
	 */
	outboxLock: "billing:outbox:lock",
} as const;
