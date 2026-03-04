import type IORedis from "ioredis";

export type IdempotencyReserveResult = "reserved" | "exists" | "in_flight";

export interface IdempotencyStoreOptions {
	getClient: () => Promise<IORedis>;
	keyPrefix: string;
	inFlightMarker?: string;
	inFlightTtlSeconds?: number;
	defaultTtlSeconds?: number;
}

export interface IdempotencyStore {
	read(scope: string, key: string): Promise<unknown | null>;
	reserve(scope: string, key: string): Promise<IdempotencyReserveResult>;
	store(scope: string, key: string, response: unknown, ttlSeconds?: number): Promise<void>;
	clear(scope: string, key: string): Promise<void>;
}

const DEFAULT_IN_FLIGHT_MARKER = "__in_flight__";
const DEFAULT_IN_FLIGHT_TTL_SECONDS = 60;
const DEFAULT_TTL_SECONDS = 60 * 60 * 24;

function buildRedisKey(prefix: string, scope: string, key: string): string {
	return `${prefix}:${scope}:${key}`;
}

export function createIdempotencyStore(options: IdempotencyStoreOptions): IdempotencyStore {
	const inFlightMarker = options.inFlightMarker ?? DEFAULT_IN_FLIGHT_MARKER;
	const inFlightTtlSeconds = options.inFlightTtlSeconds ?? DEFAULT_IN_FLIGHT_TTL_SECONDS;
	const defaultTtlSeconds = options.defaultTtlSeconds ?? DEFAULT_TTL_SECONDS;

	async function read(scope: string, key: string): Promise<unknown | null> {
		const client = await options.getClient();
		const value = await client.get(buildRedisKey(options.keyPrefix, scope, key));
		if (!value || value === inFlightMarker) return null;
		try {
			return JSON.parse(value) as unknown;
		} catch {
			return null;
		}
	}

	async function reserve(scope: string, key: string): Promise<IdempotencyReserveResult> {
		const client = await options.getClient();
		const redisKey = buildRedisKey(options.keyPrefix, scope, key);
		const reserved = await client.set(redisKey, inFlightMarker, "EX", inFlightTtlSeconds, "NX");
		if (reserved === "OK") return "reserved";

		const existing = await client.get(redisKey);
		if (existing && existing !== inFlightMarker) return "exists";
		return "in_flight";
	}

	async function store(
		scope: string,
		key: string,
		response: unknown,
		ttlSeconds = defaultTtlSeconds,
	): Promise<void> {
		const client = await options.getClient();
		await client.set(
			buildRedisKey(options.keyPrefix, scope, key),
			JSON.stringify(response),
			"EX",
			ttlSeconds,
		);
	}

	async function clear(scope: string, key: string): Promise<void> {
		const client = await options.getClient();
		await client.del(buildRedisKey(options.keyPrefix, scope, key));
	}

	return {
		read,
		reserve,
		store,
		clear,
	};
}

export const DEFAULT_IDEMPOTENCY_TTL_SECONDS = DEFAULT_TTL_SECONDS;
export const DEFAULT_IDEMPOTENCY_IN_FLIGHT_TTL_SECONDS = DEFAULT_IN_FLIGHT_TTL_SECONDS;
