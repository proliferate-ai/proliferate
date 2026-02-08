/**
 * Base snapshot build worker.
 *
 * Builds the reusable base sandbox snapshot (Layer 1) so new sessions
 * start near-instantly without relying on MODAL_BASE_SNAPSHOT_ID env var.
 */

import { env } from "@proliferate/environment/server";
import type { Logger } from "@proliferate/logger";
import {
	createBaseSnapshotBuildQueue,
	createBaseSnapshotBuildWorker,
	queueBaseSnapshotBuild,
} from "@proliferate/queue";
import { baseSnapshots } from "@proliferate/services";
import { ModalLibmodalProvider } from "@proliferate/shared/providers";
import type { Worker } from "bullmq";

interface BaseSnapshotWorkers {
	buildWorker: Worker;
}

export function startBaseSnapshotWorkers(logger: Logger): BaseSnapshotWorkers {
	const buildWorker = createBaseSnapshotBuildWorker(async (job) => {
		await handleBaseSnapshotBuild(
			job.data.versionKey,
			job.data.provider,
			job.data.modalAppName,
			logger,
		);
	});

	// Enqueue build on startup if needed (non-blocking)
	void enqueueIfNeeded(logger);

	logger.info("Workers started: base-snapshots");
	return { buildWorker };
}

export async function stopBaseSnapshotWorkers(workers: BaseSnapshotWorkers): Promise<void> {
	await workers.buildWorker.close();
}

/**
 * Check if a base snapshot build is needed and enqueue if so.
 */
async function enqueueIfNeeded(logger: Logger): Promise<void> {
	try {
		// Import lazily to avoid loading sandbox config at module level
		const { computeBaseSnapshotVersionKey } = await import("@proliferate/shared/sandbox");
		const versionKey = computeBaseSnapshotVersionKey();
		const provider = "modal";
		const modalAppName = getModalAppName();

		const needed = await baseSnapshots.isBuildNeeded(versionKey, provider, modalAppName);
		if (!needed) {
			logger.info(
				{ versionKey: versionKey.slice(0, 16), modalAppName },
				"Base snapshot already ready or building",
			);
			return;
		}

		logger.info(
			{ versionKey: versionKey.slice(0, 16), modalAppName },
			"Enqueueing base snapshot build",
		);
		const queue = createBaseSnapshotBuildQueue();
		await queueBaseSnapshotBuild(queue, { versionKey, provider, modalAppName });
		await queue.close();
	} catch (error) {
		logger.warn({ err: error }, "Failed to check/enqueue base snapshot build");
	}
}

async function handleBaseSnapshotBuild(
	versionKey: string,
	provider: string,
	modalAppName: string,
	logger: Logger,
): Promise<void> {
	const log = logger.child({
		versionKey: versionKey.slice(0, 16),
		modalAppName,
		module: "base-snapshots",
	});

	const { id, alreadyReady } = await baseSnapshots.startBuild({
		versionKey,
		provider,
		modalAppName,
	});

	if (alreadyReady) {
		log.info("Base snapshot already ready, skipping build");
		return;
	}

	log.info("Building base snapshot");
	const modalProvider = new ModalLibmodalProvider();

	try {
		const result = await modalProvider.createBaseSnapshot();
		await baseSnapshots.completeBuild(id, result.snapshotId);
		log.info({ snapshotId: result.snapshotId }, "Base snapshot built successfully");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await baseSnapshots.failBuild(id, message);
		log.error({ err: error }, "Base snapshot build failed");
		throw error; // Let BullMQ retry
	}
}

function getModalAppName(): string {
	const appName = env.MODAL_APP_NAME;
	const suffix = env.MODAL_APP_SUFFIX;
	if (!appName) {
		throw new Error("MODAL_APP_NAME is required");
	}
	return suffix ? `${appName}-${suffix}` : appName;
}
