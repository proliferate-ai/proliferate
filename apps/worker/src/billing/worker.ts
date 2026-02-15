/**
 * Billing Worker (BullMQ)
 *
 * Manages repeatable billing jobs via BullMQ queues:
 * - Compute metering (every 30s)
 * - Outbox processing (every 60s)
 * - Grace expiration (every 60s)
 * - LLM spend sync dispatch (every 30s, fan-out per org)
 * - LLM spend sync per org (dispatched by dispatcher)
 * - Nightly reconciliation (00:00 UTC)
 */

import { env } from "@proliferate/environment/server";
import type { Logger } from "@proliferate/logger";
import {
	createBillingGraceQueue,
	createBillingGraceWorker,
	createBillingLLMSyncDispatchQueue,
	createBillingLLMSyncDispatchWorker,
	createBillingLLMSyncOrgQueue,
	createBillingLLMSyncOrgWorker,
	createBillingMeteringQueue,
	createBillingMeteringWorker,
	createBillingOutboxQueue,
	createBillingOutboxWorker,
	createBillingReconcileQueue,
	createBillingReconcileWorker,
	getConnectionOptions,
} from "@proliferate/queue";
import { processGraceJob } from "../jobs/billing/grace.job";
import { processLLMSyncDispatchJob } from "../jobs/billing/llm-sync-dispatcher.job";
import { processLLMSyncOrgJob } from "../jobs/billing/llm-sync-org.job";
import { processMeteringJob } from "../jobs/billing/metering.job";
import { processOutboxJob } from "../jobs/billing/outbox.job";
import { processReconcileJob } from "../jobs/billing/reconcile.job";

// ============================================
// Billing Worker State
// ============================================

interface Closeable {
	close(): Promise<void>;
}

let closeables: Closeable[] = [];
let isRunning = false;

// ============================================
// Worker Lifecycle
// ============================================

/**
 * Start the billing worker.
 * Creates BullMQ queues with repeatable schedules and workers.
 */
export async function startBillingWorker(logger: Logger): Promise<void> {
	if (isRunning) {
		logger.warn("Already running");
		return;
	}

	logger.info("Starting billing BullMQ workers");

	const connection = getConnectionOptions();

	// Create queues
	const meteringQueue = createBillingMeteringQueue(connection);
	const outboxQueue = createBillingOutboxQueue(connection);
	const graceQueue = createBillingGraceQueue(connection);
	const reconcileQueue = createBillingReconcileQueue(connection);
	const llmSyncDispatchQueue = createBillingLLMSyncDispatchQueue(connection);
	const llmSyncOrgQueue = createBillingLLMSyncOrgQueue(connection);

	// Add repeatable schedules (idempotent — BullMQ deduplicates by repeat key)
	await meteringQueue.add("metering", {}, {
		repeat: { every: 30_000 },
	});

	await outboxQueue.add("outbox", {}, {
		repeat: { every: 60_000 },
	});

	await graceQueue.add("grace", {}, {
		repeat: { every: 60_000 },
	});

	await reconcileQueue.add("reconcile", {}, {
		repeat: { pattern: "0 0 * * *", tz: "UTC" },
	});

	await llmSyncDispatchQueue.add("llm-sync-dispatch", {}, {
		repeat: { every: 30_000 },
	});

	// Create workers
	const meteringWorker = createBillingMeteringWorker(
		async (job) => processMeteringJob(job, logger),
		connection,
	);

	const outboxWorker = createBillingOutboxWorker(
		async (job) => processOutboxJob(job, logger),
		connection,
	);

	const graceWorker = createBillingGraceWorker(
		async (job) => processGraceJob(job, logger),
		connection,
	);

	const reconcileWorker = createBillingReconcileWorker(
		async (job) => processReconcileJob(job, logger),
		connection,
	);

	const llmSyncDispatchWorker = createBillingLLMSyncDispatchWorker(
		async (job) => processLLMSyncDispatchJob(job, llmSyncOrgQueue, logger),
		connection,
	);

	const llmSyncOrgWorker = createBillingLLMSyncOrgWorker(
		async (job) => processLLMSyncOrgJob(job, logger),
		connection,
	);

	// Attach error handlers
	const workers = [
		meteringWorker,
		outboxWorker,
		graceWorker,
		reconcileWorker,
		llmSyncDispatchWorker,
		llmSyncOrgWorker,
	];
	for (const worker of workers) {
		worker.on("failed", (job, err) => {
			logger.error({ err, jobId: job?.id, queue: job?.queueName }, "Billing job failed");
		});
	}

	// Store references for shutdown
	closeables = [
		...workers,
		meteringQueue,
		outboxQueue,
		graceQueue,
		reconcileQueue,
		llmSyncDispatchQueue,
		llmSyncOrgQueue,
	];

	isRunning = true;

	logger.info(
		{
			queues: [
				"billing-metering (30s)",
				"billing-outbox (60s)",
				"billing-grace (60s)",
				"billing-reconcile (daily 00:00 UTC)",
				"billing-llm-sync-dispatch (30s)",
				"billing-llm-sync-org (on-demand)",
			],
		},
		"Billing BullMQ workers started",
	);
}

/**
 * Stop the billing worker.
 */
export async function stopBillingWorker(): Promise<void> {
	if (!isRunning) {
		return;
	}

	await Promise.all(closeables.map((c) => c.close()));
	closeables = [];
	isRunning = false;
}

/**
 * Check if billing worker is healthy.
 */
export function isBillingWorkerHealthy(): boolean {
	if (!env.NEXT_PUBLIC_BILLING_ENABLED) {
		return true;
	}

	return isRunning;
}
