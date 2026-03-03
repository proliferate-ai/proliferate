/**
 * Configuration snapshot build worker.
 *
 * With E2B, configuration snapshots are created via setup sessions (pause = snapshot).
 * This worker now just marks non-snapshot configurations as default.
 */

import type { Logger } from "@proliferate/logger";
import { createConfigurationSnapshotBuildWorker } from "@proliferate/queue";
import { configurations } from "@proliferate/services";
import type { Worker } from "bullmq";

interface ConfigurationSnapshotWorkers {
	buildWorker: Worker;
}

export function startConfigurationSnapshotWorkers(logger: Logger): ConfigurationSnapshotWorkers {
	const buildWorker = createConfigurationSnapshotBuildWorker(async (job) => {
		await handleBuild(job.data.configurationId, logger);
	});
	logger.info("Workers started: configuration-snapshots");
	return { buildWorker };
}

export async function stopConfigurationSnapshotWorkers(
	workers: ConfigurationSnapshotWorkers,
): Promise<void> {
	await workers.buildWorker.close();
}

async function handleBuild(configurationId: string, logger: Logger): Promise<void> {
	const log = logger.child({ configurationId, module: "configuration-snapshots" });

	const configuration = await configurations.findByIdForSession(configurationId);
	if (!configuration) {
		log.warn("Configuration not found, skipping");
		return;
	}

	if (configuration.snapshotId) {
		log.info({ snapshotId: configuration.snapshotId }, "Configuration snapshot already built");
		return;
	}

	await configurations.markConfigurationDefaultNoSnapshot(configurationId);
	log.info("Marked configuration as default (E2B snapshots are created via setup sessions)");
}
