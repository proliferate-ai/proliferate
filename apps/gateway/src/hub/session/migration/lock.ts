/**
 * Gateway lock — delegates to the shared lock in @proliferate/services.
 *
 * The gateway bootstraps the Redis client at startup via setLockRedisClient().
 * All lock logic lives in packages/services/src/lib/lock.ts.
 */

export {
	setLockRedisClient,
	getMigrationLockKey,
	waitForMigrationLockRelease,
	runWithMigrationLock,
} from "@proliferate/services/lock";
