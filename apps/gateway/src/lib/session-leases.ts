/**
 * Session Leases
 *
 * Redis-based ownership and runtime leases for sessions.
 * Prevents split-brain scenarios in multi-instance Gateway deployments.
 *
 * Two independent leases per session:
 * - `owner:{sessionId}` — which Gateway instance "owns" the hub (long-lived, renewed)
 * - `runtime:{sessionId}` — sandbox is alive and responsive (short-lived heartbeat)
 */

import { createLogger } from "@proliferate/logger";
import { ensureRedisConnected } from "./redis";

const logger = createLogger({ service: "gateway" }).child({ module: "session-leases" });

/** Owner lease TTL: 30 seconds. Renewed every ~10s. */
const OWNER_TTL_MS = 30_000;

/** Runtime lease TTL: 20 seconds. Renewed every ~8s. */
const RUNTIME_TTL_MS = 20_000;

function ownerKey(sessionId: string): string {
	return `lease:owner:${sessionId}`;
}

function runtimeKey(sessionId: string): string {
	return `lease:runtime:${sessionId}`;
}

/**
 * Attempt to acquire the owner lease for a session.
 * Returns true if acquired (or already held by this instance), false if another instance holds it.
 */
export async function acquireOwnerLease(sessionId: string, instanceId: string): Promise<boolean> {
	const client = await ensureRedisConnected();
	const key = ownerKey(sessionId);

	// SET NX with TTL — only succeeds if key doesn't exist
	const result = await client.set(key, instanceId, "PX", OWNER_TTL_MS, "NX");
	if (result === "OK") {
		return true;
	}

	// Check if we already own it
	const current = await client.get(key);
	if (current === instanceId) {
		// Renew
		await client.pexpire(key, OWNER_TTL_MS);
		return true;
	}

	return false;
}

/**
 * Renew the owner lease. Returns false if the lease was lost (split-brain signal).
 */
export async function renewOwnerLease(sessionId: string, instanceId: string): Promise<boolean> {
	const client = await ensureRedisConnected();
	const key = ownerKey(sessionId);

	const current = await client.get(key);
	if (current !== instanceId) {
		logger.warn({ sessionId, instanceId, currentOwner: current }, "Owner lease lost");
		return false;
	}

	await client.pexpire(key, OWNER_TTL_MS);
	return true;
}

/**
 * Release the owner lease (only if we still hold it).
 */
export async function releaseOwnerLease(sessionId: string, instanceId: string): Promise<void> {
	const client = await ensureRedisConnected();
	const key = ownerKey(sessionId);

	// Atomic check-and-delete via Lua
	const script = `
		if redis.call("get", KEYS[1]) == ARGV[1] then
			return redis.call("del", KEYS[1])
		else
			return 0
		end
	`;
	await client.eval(script, 1, key, instanceId);
}

/**
 * Set the runtime lease (sandbox is alive). Overwrites unconditionally.
 */
export async function setRuntimeLease(sessionId: string): Promise<void> {
	const client = await ensureRedisConnected();
	await client.set(runtimeKey(sessionId), "1", "PX", RUNTIME_TTL_MS);
}

/**
 * Check if a runtime lease exists (sandbox is presumably alive).
 */
export async function hasRuntimeLease(sessionId: string): Promise<boolean> {
	const client = await ensureRedisConnected();
	const exists = await client.exists(runtimeKey(sessionId));
	return exists === 1;
}

/**
 * Remove the runtime lease (sandbox terminated or paused).
 */
export async function clearRuntimeLease(sessionId: string): Promise<void> {
	const client = await ensureRedisConnected();
	await client.del(runtimeKey(sessionId));
}

export const OWNER_LEASE_TTL_MS = OWNER_TTL_MS;
export const RUNTIME_LEASE_TTL_MS = RUNTIME_TTL_MS;
