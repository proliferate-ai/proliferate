/**
 * Webhook Inbox Worker — BullMQ worker that processes webhook_inbox rows.
 *
 * Reads rows from the inbox, delegates to the processor, and marks them
 * as completed or failed.
 */

import { createWebhookInboxWorker } from "@proliferate/queue";
import { webhookInbox } from "@proliferate/services";
import { logger as rootLogger } from "../lib/logger.js";
import { processInboxRow } from "./processor.js";

const logger = rootLogger.child({ module: "inbox-worker" });

export function startWebhookInboxWorker() {
	const worker = createWebhookInboxWorker(async (job) => {
		const { inboxId } = job.data;

		const row = await webhookInbox.findById(inboxId);
		if (!row) {
			logger.warn({ inboxId }, "Inbox row not found, skipping");
			return;
		}

		if (row.status !== "pending") {
			logger.info({ inboxId, status: row.status }, "Inbox row already processed");
			return;
		}

		try {
			await processInboxRow(row);
			await webhookInbox.markCompleted(inboxId);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error({ err, inboxId, provider: row.provider }, "Inbox processing failed");
			await webhookInbox.markFailed(inboxId, message);
			throw err; // Re-throw so BullMQ can retry
		}
	});

	logger.info("Webhook inbox worker started");
	return worker;
}
