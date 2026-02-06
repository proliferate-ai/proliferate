/**
 * Idempotency helpers for gateway HTTP routes.
 *
 * Uses Redis for short-term storage of request results.
 */

import { ensureRedisConnected } from "./redis";

const IDEMPOTENCY_PREFIX = "gateway:idempotency";
const IN_FLIGHT = "__in_flight__";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24h
const IN_FLIGHT_TTL_SECONDS = 60; // 1m

function buildKey(orgId: string, key: string): string {
	return `${IDEMPOTENCY_PREFIX}:${orgId}:${key}`;
}

export async function readIdempotencyResponse(orgId: string, key: string): Promise<unknown | null> {
	const client = await ensureRedisConnected();
	const value = await client.get(buildKey(orgId, key));
	if (!value || value === IN_FLIGHT) return null;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return null;
	}
}

export async function reserveIdempotencyKey(
	orgId: string,
	key: string,
): Promise<"reserved" | "exists" | "in_flight"> {
	const client = await ensureRedisConnected();
	const redisKey = buildKey(orgId, key);
	const reserved = await client.set(redisKey, IN_FLIGHT, "EX", IN_FLIGHT_TTL_SECONDS, "NX");
	if (reserved === "OK") {
		return "reserved";
	}
	const existing = await client.get(redisKey);
	if (existing && existing !== IN_FLIGHT) {
		return "exists";
	}
	return "in_flight";
}

export async function storeIdempotencyResponse(
	orgId: string,
	key: string,
	response: unknown,
	ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<void> {
	const client = await ensureRedisConnected();
	await client.set(buildKey(orgId, key), JSON.stringify(response), "EX", ttlSeconds);
}

export async function clearIdempotencyKey(orgId: string, key: string): Promise<void> {
	const client = await ensureRedisConnected();
	await client.del(buildKey(orgId, key));
}
