/**
 * Inbox Garbage Collection Worker.
 *
 * Periodically deletes old completed/failed webhook inbox rows
 * to prevent PostgreSQL table bloat. Runs every hour with a
 * default retention of 7 days.
 */

import { type InboxGcJob, createInboxGcQueue, createInboxGcWorker } from "@proliferate/queue";
import { webhookInbox } from "@proliferate/services";
import type { Job } from "bullmq";
import { logger as rootLogger } from "../lib/logger.js";

const logger = rootLogger.child({ module: "inbox-gc" });

const DEFAULT_RETENTION_DAYS = 7;

async function processGc(job: Job<InboxGcJob>): Promise<void> {
	const retentionDays = job.data.retentionDays ?? DEFAULT_RETENTION_DAYS;
	const deleted = await webhookInbox.gcOldRows(retentionDays);

	if (deleted > 0) {
		logger.info({ deleted, retentionDays }, "Inbox GC completed");
	}
}

/**
 * Start the inbox garbage collection worker.
 * Schedules a repeatable job every hour.
 */
export async function startInboxGcWorker(): Promise<{
	worker: ReturnType<typeof createInboxGcWorker>;
	close: () => Promise<void>;
}> {
	const queue = createInboxGcQueue();
	const worker = createInboxGcWorker(processGc);

	// Schedule repeatable GC job every hour
	await queue.add(
		"inbox-gc",
		{ retentionDays: DEFAULT_RETENTION_DAYS },
		{
			repeat: { every: 3600000 }, // 1 hour
			jobId: "inbox-gc",
		},
	);

	worker.on("failed", (job, err) => {
		logger.error({ err, jobId: job?.id }, "Inbox GC job failed");
	});

	logger.info("Inbox GC worker started");

	return {
		worker,
		close: async () => {
			await worker.close();
			await queue.close();
		},
	};
}
