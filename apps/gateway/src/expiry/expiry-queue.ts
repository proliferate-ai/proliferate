import { Queue, Worker } from "bullmq";
import type { HubManager } from "../hub";
import { MigrationConfig } from "../hub/types";
import type { GatewayEnv } from "../lib/env";

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
}

export function startSessionExpiryWorker(env: GatewayEnv, hubManager: HubManager): void {
	const connection = getConnection(env);

	if (!worker) {
		worker = new Worker<SessionExpiryJob>(
			QUEUE_NAME,
			async (job) => {
				const sessionId = job.data.sessionId;
				const hub = await hubManager.getOrCreate(sessionId);
				await hub.runExpiryMigration();
			},
			{ connection },
		);

		worker.on("failed", (job, err) => {
			console.error(
				"[ExpiryWorker] Job failed",
				{ jobId: job?.id, sessionId: job?.data?.sessionId },
				err,
			);
		});
	}
}
