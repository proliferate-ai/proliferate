/**
 * Distributed migration lock (Redlock-based).
 *
 * Shared between Gateway, Worker, and any other service that needs
 * to safely coordinate snapshot/terminate/pause operations on sessions.
 *
 * Uses an injectable Redis client pattern (like the logger) so callers
 * set the Redis connection at startup.
 */

import type IORedis from "ioredis";
// @ts-expect-error - redlock types don't resolve properly due to ESM exports
import Redlock from "redlock";
import { getServicesLogger } from "../logger";

let redisClient: IORedis | null = null;
let redlockInstance: Redlock | null = null;

/**
 * Inject the Redis client used for distributed locking.
 * Must be called once at service startup before any lock operations.
 */
export function setLockRedisClient(client: IORedis): void {
	redisClient = client;
	redlockInstance = null; // reset so next call rebuilds with new client
}

function getRedlock(): Redlock {
	if (!redisClient) {
		throw new Error("Lock Redis client not set. Call setLockRedisClient() at startup.");
	}

	if (!redlockInstance) {
		redlockInstance = new Redlock([redisClient], {
			retryCount: 0,
			driftFactor: 0.01,
		});
		redlockInstance.on("error", (err: unknown) => {
			getServicesLogger().child({ module: "lock" }).error({ err }, "Redlock error");
		});
	}

	return redlockInstance;
}

export function getMigrationLockKey(sessionId: string): string {
	return `lock:session:${sessionId}:migration`;
}

/**
 * Wait until the migration lock for a session is released.
 * Polls every 250ms until it can briefly acquire (and immediately release) the lock.
 */
export async function waitForMigrationLockRelease(sessionId: string): Promise<void> {
	const redlock = getRedlock();
	const lockKey = getMigrationLockKey(sessionId);
	const retryDelay = 250;
	const lockTtl = 5000;

	while (true) {
		try {
			const lock = await redlock.acquire([lockKey], lockTtl, {
				retryCount: 0,
			});
			await lock.release();
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, retryDelay));
		}
	}
}

/**
 * Run a callback under the migration lock for a session.
 * Returns null if the lock is already held (non-blocking).
 */
export async function runWithMigrationLock<T>(
	sessionId: string,
	ttlMs: number,
	fn: () => Promise<T>,
): Promise<T | null> {
	const redlock = getRedlock();
	const lockKey = getMigrationLockKey(sessionId);
	try {
		return await redlock.using([lockKey], ttlMs, { retryCount: 0 }, async () => fn());
	} catch (err) {
		const isLockContention = err instanceof Error && err.message.includes("attempts");
		if (!isLockContention) {
			getServicesLogger()
				.child({ module: "lock" })
				.warn({ err, lockKey }, "Lock acquire failed (not contention)");
		}
		return null;
	}
}
