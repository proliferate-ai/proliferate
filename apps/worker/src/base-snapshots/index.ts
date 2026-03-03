/**
 * Base snapshot build worker.
 *
 * Base snapshots were a Modal-specific concept (pre-baked filesystem layers).
 * E2B uses templates instead. This worker is a no-op stub retained for queue compatibility.
 */

import type { Logger } from "@proliferate/logger";
import {
	createBaseSnapshotBuildWorker,
} from "@proliferate/queue";
import type { Worker } from "bullmq";

interface BaseSnapshotWorkers {
	buildWorker: Worker;
}

export function startBaseSnapshotWorkers(logger: Logger): BaseSnapshotWorkers {
	const buildWorker = createBaseSnapshotBuildWorker(async (_job) => {
		logger.info("Base snapshot builds are not needed with E2B, skipping");
	});

	logger.info("Workers started: base-snapshots (no-op)");
	return { buildWorker };
}

export async function stopBaseSnapshotWorkers(workers: BaseSnapshotWorkers): Promise<void> {
	await workers.buildWorker.close();
}
