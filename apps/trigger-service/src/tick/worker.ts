/**
 * V1 Tick Engine — produces wake_events(source=tick) for active workers.
 *
 * Runs as a repeatable BullMQ job on a configurable interval (default 60s).
 * For each active worker without a pending tick wake, creates a new tick wake event.
 */

import { runtimeEnv } from "@proliferate/environment/runtime";
import { createTickQueue, createTickWorker } from "@proliferate/queue";
import type { Worker } from "@proliferate/queue";
import { wakes, workers as workersService } from "@proliferate/services";
import { logger as rootLogger } from "../lib/logger.js";

const logger = rootLogger.child({ module: "tick-engine" });

const TICK_INTERVAL_MS = Number(runtimeEnv.TICK_INTERVAL_MS) || 60_000;

export function startTickWorker(): Worker {
	const worker = createTickWorker(async () => {
		await processTickCycle();
	});

	worker.on("failed", (job, err) => {
		logger.error({ err, jobId: job?.id }, "Tick job failed");
	});

	return worker;
}

export async function scheduleTickJob(): Promise<void> {
	const queue = createTickQueue();
	try {
		await queue.add(
			"tick",
			{},
			{
				repeat: { every: TICK_INTERVAL_MS },
				jobId: "tick",
			},
		);
		logger.info({ intervalMs: TICK_INTERVAL_MS }, "Tick engine scheduled");
	} finally {
		await queue.close();
	}
}

async function processTickCycle(): Promise<void> {
	const activeWorkers = await workersService.listActiveWorkers();

	if (activeWorkers.length === 0) {
		return;
	}

	let created = 0;
	let skipped = 0;

	for (const worker of activeWorkers) {
		const hasQueuedTick = await wakes.hasQueuedWakeBySource(worker.id, "tick");
		if (hasQueuedTick) {
			skipped++;
			continue;
		}

		await wakes.createWakeEvent({
			workerId: worker.id,
			organizationId: worker.organizationId,
			source: "tick",
		});
		created++;
	}

	if (created > 0 || skipped > 0) {
		logger.info({ activeWorkers: activeWorkers.length, created, skipped }, "Tick cycle complete");
	}
}
