/**
 * BullMQ processor: snapshot retention cleanup.
 *
 * Runs daily at 01:00 UTC. Evicts expired snapshots across all orgs
 * using the global SNAPSHOT_RETENTION_DAYS cap.
 */

import type { Logger } from "@proliferate/logger";
import type { BillingSnapshotCleanupJob, Job } from "@proliferate/queue";
import { billing } from "@proliferate/services";

export async function processSnapshotCleanupJob(
	_job: Job<BillingSnapshotCleanupJob>,
	logger: Logger,
): Promise<void> {
	try {
		const { deletedCount } = await billing.cleanupAllExpiredSnapshots();
		if (deletedCount > 0) {
			logger.info({ deletedCount }, "Snapshot cleanup complete");
		}
	} catch (err) {
		logger.error({ err }, "Snapshot cleanup error");
		throw err;
	}
}
