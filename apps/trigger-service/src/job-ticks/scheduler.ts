/**
 * Worker Job Tick Scheduler
 *
 * 1. startJobTickWorker() — creates BullMQ worker with the processor
 * 2. syncJobTickSchedules() — queries all enabled jobs from DB, syncs BullMQ
 *    repeatable jobs. Runs on startup and every 60s.
 */

import {
	type Worker,
	type WorkerJobTickPayload,
	createWorkerJobTickQueue,
	createWorkerJobTickWorker,
} from "@proliferate/queue";
import { workerJobs, workers as workersService } from "@proliferate/services";
import { logger as rootLogger } from "../lib/logger.js";
import { processJobTick } from "./processor.js";

const logger = rootLogger.child({ module: "job-tick-scheduler" });

const SYNC_INTERVAL_MS = 60_000;

function repeatableKeyPrefix(jobId: string): string {
	return `job-tick:${jobId}`;
}

/**
 * Create and start the BullMQ worker that processes job ticks.
 */
export function startJobTickWorker(): Worker<WorkerJobTickPayload> {
	const worker = createWorkerJobTickWorker(processJobTick);

	worker.on("failed", (job, err) => {
		logger.error({ err, jobId: job?.id }, "Worker job tick failed");
	});

	logger.info("Job tick worker started");
	return worker;
}

/**
 * Sync BullMQ repeatable jobs with enabled worker jobs from the database.
 *
 * - Adds repeatables for new/changed enabled jobs
 * - Removes repeatables for deleted/disabled jobs
 */
export async function syncJobTickSchedules(): Promise<void> {
	const queue = createWorkerJobTickQueue();
	try {
		// Fetch all enabled jobs from DB
		const enabledJobs = await workerJobs.listAllEnabledJobs();

		// Build a map of desired repeatable jobs (jobId -> job)
		const desiredMap = new Map<string, (typeof enabledJobs)[number]>();
		for (const job of enabledJobs) {
			desiredMap.set(job.id, job);
		}

		// Load active workers for eligibility filtering
		const activeWorkers = await workersService.listActiveWorkers();

		// Get existing repeatable jobs in BullMQ
		const existingRepeatables = await queue.getRepeatableJobs();

		// Build a set of existing job-tick repeatable keys
		const existingKeyMap = new Map<
			string,
			{ key: string; pattern: string | null; sessionId: string | null }
		>();
		for (const rep of existingRepeatables) {
			if (rep.name.startsWith("job-tick:")) {
				// Name format: "job-tick:{jobId}" or "job-tick:{jobId}:{sessionId}"
				const rest = rep.name.slice("job-tick:".length);
				const colonIdx = rest.indexOf(":");
				const jobId = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
				const sessionId = colonIdx >= 0 ? rest.slice(colonIdx + 1) : null;
				existingKeyMap.set(jobId, { key: rep.key, pattern: rep.pattern ?? null, sessionId });
			}
		}

		// Build a lookup from workerId -> managerSessionId
		const workerSessionMap = new Map<string, string>();
		for (const worker of activeWorkers) {
			workerSessionMap.set(worker.id, worker.managerSessionId);
		}

		// Add or update repeatables for enabled jobs with active workers
		let added = 0;
		let removed = 0;

		for (const [jobId, workerJob] of desiredMap) {
			const managerSessionId = workerSessionMap.get(workerJob.workerId);
			if (!managerSessionId) {
				// Worker not active — remove if exists
				const existing = existingKeyMap.get(jobId);
				if (existing) {
					await queue.removeRepeatableByKey(existing.key);
					existingKeyMap.delete(jobId);
					removed++;
				}
				continue;
			}

			const existing = existingKeyMap.get(jobId);
			if (
				existing &&
				existing.pattern === workerJob.cronExpression &&
				existing.sessionId === managerSessionId
			) {
				// Already scheduled with the correct cron and session — skip
				existingKeyMap.delete(jobId);
				continue;
			}

			// Remove stale schedule if cron or session changed
			if (existing) {
				await queue.removeRepeatableByKey(existing.key);
				existingKeyMap.delete(jobId);
			}

			// Add new repeatable — encode sessionId in name so changes are detected
			const name = `${repeatableKeyPrefix(jobId)}:${managerSessionId}`;
			await queue.add(
				name,
				{
					jobId,
					workerId: workerJob.workerId,
					organizationId: workerJob.organizationId,
					managerSessionId,
				} satisfies WorkerJobTickPayload,
				{
					repeat: { pattern: workerJob.cronExpression },
					jobId: name,
				},
			);
			added++;
		}

		// Remove stale repeatables (jobs that were deleted or disabled)
		for (const [, stale] of existingKeyMap) {
			await queue.removeRepeatableByKey(stale.key);
			removed++;
		}

		if (added > 0 || removed > 0) {
			logger.info({ enabledJobs: enabledJobs.length, added, removed }, "Job tick schedules synced");
		}
	} finally {
		await queue.close();
	}
}

/**
 * Start the sync loop: run once immediately, then every 60s.
 * Returns a cleanup function to stop the interval.
 */
export function startJobTickScheduleSync(): { stop: () => void } {
	let stopped = false;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	const runSync = async () => {
		if (stopped) return;
		try {
			await syncJobTickSchedules();
		} catch (err) {
			logger.error({ err }, "Job tick schedule sync failed");
		} finally {
			if (!stopped) {
				timeoutId = setTimeout(runSync, SYNC_INTERVAL_MS);
			}
		}
	};

	void runSync();

	return {
		stop: () => {
			stopped = true;
			if (timeoutId) clearTimeout(timeoutId);
		},
	};
}
