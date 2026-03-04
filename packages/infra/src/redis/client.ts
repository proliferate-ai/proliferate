import type IORedis from "ioredis";
import type { RedisOptions } from "ioredis";

export interface RedisClientManagerOptions {
	redisUrl: string;
	clientOptions?: RedisOptions;
	onError?: (error: Error) => void;
	onConnect?: () => void;
}

export interface RedisClientManager {
	getClient(): Promise<IORedis>;
	ensureConnected(): Promise<IORedis>;
	close(): Promise<void>;
}

export function createRedisClientManager(options: RedisClientManagerOptions): RedisClientManager {
	let redisClient: IORedis | null = null;
	let connectionPromise: Promise<void> | null = null;

	async function getClient(): Promise<IORedis> {
		if (!redisClient) {
			const { default: Redis } = await import("ioredis");
			redisClient = new Redis(options.redisUrl, {
				maxRetriesPerRequest: 3,
				enableReadyCheck: true,
				lazyConnect: true,
				...options.clientOptions,
			});

			if (options.onError) {
				redisClient.on("error", (err: Error) => options.onError?.(err));
			}
			if (options.onConnect) {
				redisClient.on("connect", () => options.onConnect?.());
			}
		}

		return redisClient;
	}

	async function ensureConnected(): Promise<IORedis> {
		const client = await getClient();
		if ((client.status as string) === "ready") {
			return client;
		}

		if (!connectionPromise) {
			connectionPromise = client.connect().catch((err: Error) => {
				connectionPromise = null;
				throw err;
			});
		}

		await connectionPromise;
		if ((client.status as string) !== "ready") {
			throw new Error("Redis connection not ready");
		}

		return client;
	}

	async function close(): Promise<void> {
		if (redisClient) {
			await redisClient.quit();
			redisClient = null;
			connectionPromise = null;
		}
	}

	return {
		getClient,
		ensureConnected,
		close,
	};
}
