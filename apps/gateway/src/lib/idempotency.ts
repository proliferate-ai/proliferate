/**
 * Idempotency helpers for gateway HTTP routes.
 *
 * Uses Redis for short-term storage of request results.
 */

import { createIdempotencyStore } from "@proliferate/infra";
import { ensureRedisConnected } from "./redis";

const IDEMPOTENCY_PREFIX = "gateway:idempotency";
const IN_FLIGHT = "__in_flight__";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24h
const IN_FLIGHT_TTL_SECONDS = 60; // 1m

export const IDEMPOTENCY_DEFAULT_TTL_SECONDS = DEFAULT_TTL_SECONDS;
export const IDEMPOTENCY_IN_FLIGHT_TTL_SECONDS = IN_FLIGHT_TTL_SECONDS;

const idempotencyStore = createIdempotencyStore({
	getClient: ensureRedisConnected,
	keyPrefix: IDEMPOTENCY_PREFIX,
	inFlightMarker: IN_FLIGHT,
	inFlightTtlSeconds: IN_FLIGHT_TTL_SECONDS,
	defaultTtlSeconds: DEFAULT_TTL_SECONDS,
});

export async function readIdempotencyResponse(orgId: string, key: string): Promise<unknown | null> {
	return idempotencyStore.read(orgId, key);
}

export async function reserveIdempotencyKey(
	orgId: string,
	key: string,
): Promise<"reserved" | "exists" | "in_flight"> {
	return idempotencyStore.reserve(orgId, key);
}

export async function storeIdempotencyResponse(
	orgId: string,
	key: string,
	response: unknown,
	ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<void> {
	await idempotencyStore.store(orgId, key, response, ttlSeconds);
}

export async function clearIdempotencyKey(orgId: string, key: string): Promise<void> {
	await idempotencyStore.clear(orgId, key);
}
