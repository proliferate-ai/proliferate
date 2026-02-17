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
	createBillingSnapshotCleanupQueue,
	createBillingSnapshotCleanupWorker,
	getConnectionOptions,
} from "@proliferate/queue";
import { processGraceJob } from "../jobs/billing/grace.job";
import { processLLMSyncDispatchJob } from "../jobs/billing/llm-sync-dispatcher.job";
import { processLLMSyncOrgJob } from "../jobs/billing/llm-sync-org.job";
import { processMeteringJob } from "../jobs/billing/metering.job";
import { processOutboxJob } from "../jobs/billing/outbox.job";
import { processReconcileJob } from "../jobs/billing/reconcile.job";
import { processSnapshotCleanupJob } from "../jobs/billing/snapshot-cleanup.job";

// ============================================
// Billing Worker State
// ============================================

interface Closeable {
	close(): Promise<void>;
}

let closeables: Closeable[] = [];
let isRunning = false;

function getNextDailyUtcRunAt(hourUtc: number, minuteUtc: number): string {
	const now = new Date();
	const next = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, minuteUtc, 0, 0),
	);

	if (next.getTime() <= now.getTime()) {
		next.setUTCDate(next.getUTCDate() + 1);
	}

	return next.toISOString();
}

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
	const snapshotCleanupQueue = createBillingSnapshotCleanupQueue(connection);

	// Add repeatable schedules (idempotent — BullMQ deduplicates by repeat key)
	await meteringQueue.add(
		"metering",
		{},
		{
			repeat: { every: 30_000 },
		},
	);

	await outboxQueue.add(
		"outbox",
		{},
		{
			repeat: { every: 60_000 },
		},
	);

	await graceQueue.add(
		"grace",
		{},
		{
			repeat: { every: 60_000 },
		},
	);

	await reconcileQueue.add(
		"reconcile",
		{},
		{
			repeat: { pattern: "0 0 * * *", tz: "UTC" },
		},
	);

	await llmSyncDispatchQueue.add(
		"llm-sync-dispatch",
		{},
		{
			repeat: { every: 30_000 },
		},
	);

	await snapshotCleanupQueue.add(
		"snapshot-cleanup",
		{},
		{
			repeat: { pattern: "0 1 * * *", tz: "UTC" }, // Daily at 01:00 UTC
		},
	);

	logger.info(
		{
			nextRunAt: getNextDailyUtcRunAt(1, 0),
			retentionDays: env.SNAPSHOT_RETENTION_DAYS,
		},
		"Scheduled snapshot cleanup job",
	);

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

	const snapshotCleanupWorker = createBillingSnapshotCleanupWorker(
		async (job) => processSnapshotCleanupJob(job, logger),
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
		snapshotCleanupWorker,
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
		snapshotCleanupQueue,
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
				"billing-snapshot-cleanup (daily 01:00 UTC)",
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
