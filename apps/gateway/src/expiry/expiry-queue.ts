import { createLogger } from "@proliferate/logger";
import { Queue, Worker } from "bullmq";
import type { HubManager } from "../hub";
import { MigrationConfig } from "../hub/types";
import type { GatewayEnv } from "../lib/env";

const logger = createLogger({ service: "gateway" }).child({ module: "expiry" });

interface SessionExpiryJob {
	sessionId: string;
}

const QUEUE_NAME = "session-expiry";
const JOB_PREFIX = "session_expiry__";

let queue: Queue<SessionExpiryJob> | null = null;
let worker: Worker<SessionExpiryJob> | null = null;

function getConnection(env: GatewayEnv) {
	return {
		url: env.redisUrl,
		maxRetriesPerRequest: null,
		enableReadyCheck: false,
	};
}

function getQueue(env: GatewayEnv): Queue<SessionExpiryJob> {
	const connection = getConnection(env);
	if (!queue) {
		queue = new Queue<SessionExpiryJob>(QUEUE_NAME, { connection });
	}
	return queue;
}

export async function scheduleSessionExpiry(
	env: GatewayEnv,
	sessionId: string,
	expiresAtMs: number | null,
): Promise<void> {
	if (!expiresAtMs) {
		return;
	}
	const startMs = Date.now();
	const q = getQueue(env);

	const delay = Math.max(0, expiresAtMs - Date.now() - MigrationConfig.GRACE_MS);
	const jobId = `${JOB_PREFIX}${sessionId}`;

	const existing = await q.getJob(jobId);
	if (existing) {
		await existing.remove();
	}

	await q.add(
		"session_expiry",
		{ sessionId },
		{
			jobId,
			delay,
			removeOnComplete: true,
			removeOnFail: true,
		},
	);

	logger.info(
		{
			latency: true,
			sessionId,
			shortId: sessionId.slice(0, 8),
			expiresAt: new Date(expiresAtMs).toISOString(),
			graceMs: MigrationConfig.GRACE_MS,
			delayMs: delay,
			durationMs: Date.now() - startMs,
		},
		"expiry.schedule",
	);
}

export function startSessionExpiryWorker(env: GatewayEnv, hubManager: HubManager): void {
	const connection = getConnection(env);

	if (!worker) {
		worker = new Worker<SessionExpiryJob>(
			QUEUE_NAME,
			async (job) => {
				const startMs = Date.now();
				const sessionId = job.data.sessionId;
				logger.debug(
					{ latency: true, sessionId, shortId: sessionId.slice(0, 8), jobId: job.id },
					"expiry.job.start",
				);
				const hub = await hubManager.getOrCreate(sessionId);
				await hub.runExpiryMigration();
				logger.info(
					{
						latency: true,
						sessionId,
						shortId: sessionId.slice(0, 8),
						jobId: job.id,
						durationMs: Date.now() - startMs,
					},
					"expiry.job.complete",
				);
			},
			{ connection },
		);

		worker.on("failed", (job, err) => {
			logger.error({ err, jobId: job?.id, sessionId: job?.data?.sessionId }, "Expiry job failed");
		});
	}
}
