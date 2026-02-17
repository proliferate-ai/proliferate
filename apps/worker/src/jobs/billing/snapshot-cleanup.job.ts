/**
 * BullMQ processor: snapshot retention cleanup.
 *
 * Runs daily at 01:00 UTC. Evicts expired snapshots across all orgs
 * using the global SNAPSHOT_RETENTION_DAYS cap.
 */

import { env } from "@proliferate/environment/server";
import type { Logger } from "@proliferate/logger";
import type { BillingSnapshotCleanupJob, Job } from "@proliferate/queue";
import { billing } from "@proliferate/services";

export async function processSnapshotCleanupJob(
	_job: Job<BillingSnapshotCleanupJob>,
	logger: Logger,
): Promise<void> {
	logger.info(
		{
			jobId: _job.id,
			retentionDays: env.SNAPSHOT_RETENTION_DAYS,
		},
		`Snapshot cleanup started (jobId=${_job.id ?? "unknown"}, retentionDays=${env.SNAPSHOT_RETENTION_DAYS})`,
	);

	try {
		const { deletedCount } = await billing.cleanupAllExpiredSnapshots();
		logger.info(
			{ deletedCount, retentionDays: env.SNAPSHOT_RETENTION_DAYS },
			`Snapshot cleanup complete (deletedCount=${deletedCount}, retentionDays=${env.SNAPSHOT_RETENTION_DAYS})`,
		);
	} catch (err) {
		logger.error({ err }, "Snapshot cleanup error");
		throw err;
	}
}
