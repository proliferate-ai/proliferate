/**
 * Webhook Inbox Worker — Async webhook processing.
 *
 * Drains the webhook_inbox table, parsing, matching, and creating
 * automation runs for each queued webhook payload.
 *
 * This worker is the second half of the Fast-Ack pattern:
 * 1. Express handler: verify + INSERT + 200 (fast path)
 * 2. This worker: parse + match + hydrate + create run (async path)
 */

import type { Job } from "@proliferate/queue";
import {
	type WebhookInboxJob,
	createWebhookInboxQueue,
	createWebhookInboxWorker,
} from "@proliferate/queue";
import { integrations, triggers as triggerService, webhookInbox } from "@proliferate/services";
import { registry } from "@proliferate/triggers";
import type { Request } from "express";
import { logger as rootLogger } from "../lib/logger.js";
import { processTriggerEvents } from "../lib/trigger-processor.js";

const logger = rootLogger.child({ module: "webhook-inbox-worker" });

const DEFAULT_BATCH_SIZE = 10;

/**
 * Process a batch of webhook inbox rows.
 */
async function processInboxBatch(job: Job<WebhookInboxJob>): Promise<void> {
	const batchSize = job.data.batchSize ?? DEFAULT_BATCH_SIZE;
	const rows = await webhookInbox.claimBatch(batchSize);

	if (rows.length === 0) return;

	logger.debug({ count: rows.length }, "Claimed inbox batch");

	for (const row of rows) {
		try {
			await processInboxRow(row);
			await webhookInbox.markCompleted(row.id);
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			logger.error({ err, inboxId: row.id, provider: row.provider }, "Failed to process inbox row");
			await webhookInbox.markFailed(row.id, errorMessage);
		}
	}
}

/**
 * Process a single inbox row:
 * 1. Resolve integration from Nango connection metadata
 * 2. Find active triggers for the integration
 * 3. Parse events using the trigger provider
 * 4. Run matching and create automation runs
 */
async function processInboxRow(row: webhookInbox.WebhookInboxRow): Promise<void> {
	const payload = row.payload as Record<string, unknown>;
	const headers = (row.headers ?? {}) as Record<string, string | string[] | undefined>;

	// For Nango-forwarded webhooks, resolve via connectionId
	const connectionId = extractConnectionId(payload);
	if (!connectionId) {
		logger.debug({ inboxId: row.id, provider: row.provider }, "No connectionId found, skipping");
		return;
	}

	const integration = await integrations.findByConnectionIdAndProvider(connectionId, "nango");
	if (!integration) {
		logger.debug({ inboxId: row.id, connectionId }, "Integration not found for connection");
		return;
	}

	// Find active webhook triggers for this integration
	const triggerRows = await triggerService.findActiveWebhookTriggers(integration.id);
	if (triggerRows.length === 0) {
		logger.debug({ inboxId: row.id, integrationId: integration.id }, "No active triggers");
		return;
	}

	// Parse using existing trigger registry
	const providerKey =
		(payload.providerConfigKey as string) || (payload.from as string) || row.provider;
	const triggerDefs = registry.webhooksByProvider(providerKey);
	if (triggerDefs.length === 0) {
		logger.debug({ inboxId: row.id, provider: providerKey }, "No trigger definitions for provider");
		return;
	}

	// Build a mock request for existing webhook trigger parsers
	const mockReq = {
		body: payload,
		headers,
	} as Request;

	for (const triggerDef of triggerDefs) {
		const events = await triggerDef.webhook(mockReq);
		if (events.length === 0) continue;

		for (const triggerRow of triggerRows) {
			if (triggerRow.provider !== triggerDef.provider) continue;
			await processTriggerEvents(triggerDef, triggerRow, events);
		}
	}
}

/**
 * Extract Nango connectionId from the webhook payload.
 */
function extractConnectionId(payload: Record<string, unknown>): string | null {
	// Nango forward payload structure
	if (payload.connectionId && typeof payload.connectionId === "string") {
		return payload.connectionId;
	}
	// Nested in from field
	if (payload.from && typeof payload.from === "object") {
		const from = payload.from as Record<string, unknown>;
		if (from.connectionId && typeof from.connectionId === "string") {
			return from.connectionId;
		}
	}
	return null;
}

/**
 * Start the webhook inbox worker.
 * Schedules a repeatable job every 5 seconds to drain the inbox.
 */
export async function startWebhookInboxWorker(): Promise<{
	worker: ReturnType<typeof createWebhookInboxWorker>;
	close: () => Promise<void>;
}> {
	const queue = createWebhookInboxQueue();
	const worker = createWebhookInboxWorker(processInboxBatch);

	// Schedule repeatable drain job every 5 seconds
	await queue.add(
		"drain-inbox",
		{ batchSize: DEFAULT_BATCH_SIZE },
		{
			repeat: { every: 5000 },
			jobId: "drain-inbox",
		},
	);

	worker.on("failed", (job, err) => {
		logger.error({ err, jobId: job?.id }, "Inbox worker job failed");
	});

	logger.info("Webhook inbox worker started");

	return {
		worker,
		close: async () => {
			await worker.close();
			await queue.close();
		},
	};
}
