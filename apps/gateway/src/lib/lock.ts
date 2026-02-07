import { createLogger } from "@proliferate/logger";
import type IORedis from "ioredis";
// @ts-expect-error - redlock types don't resolve properly due to ESM exports
import Redlock from "redlock";
import { ensureRedisConnected } from "./redis";

const logger = createLogger({ service: "gateway" }).child({ module: "lock" });

let redlockInstance: Redlock | null = null;

async function getRedlock(): Promise<Redlock> {
	const client = await ensureRedisConnected();

	if (!redlockInstance) {
		redlockInstance = new Redlock([client as IORedis], {
			retryCount: 0,
			driftFactor: 0.01,
		});
		redlockInstance.on("error", (err: unknown) => {
			logger.error({ err }, "Redlock error");
		});
	}

	return redlockInstance;
}

export function getMigrationLockKey(sessionId: string): string {
	return `lock:session:${sessionId}:migration`;
}

export async function waitForMigrationLockRelease(sessionId: string): Promise<void> {
	const redlock = await getRedlock();
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

export async function runWithMigrationLock<T>(
	sessionId: string,
	ttlMs: number,
	fn: () => Promise<T>,
): Promise<T | null> {
	const redlock = await getRedlock();
	const lockKey = getMigrationLockKey(sessionId);
	try {
		return await redlock.using([lockKey], ttlMs, async () => fn(), {
			retryCount: 0,
		});
	} catch {
		return null;
	}
}
