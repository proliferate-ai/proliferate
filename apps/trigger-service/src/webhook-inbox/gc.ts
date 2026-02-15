/**
 * Webhook Inbox Garbage Collection — lightweight cron that
 * deletes completed/failed rows older than 7 days to prevent DB bloat.
 */

import { webhookInbox } from "@proliferate/services";
import { logger as rootLogger } from "../lib/logger.js";

const logger = rootLogger.child({ module: "inbox-gc" });

const GC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function startInboxGc(): ReturnType<typeof setInterval> {
	logger.info("Webhook inbox GC started (interval: 1h)");

	return setInterval(async () => {
		try {
			const deleted = await webhookInbox.gc();
			if (deleted > 0) {
				logger.info({ deleted }, "Inbox GC completed");
			}
		} catch (err) {
			logger.error({ err }, "Inbox GC failed");
		}
	}, GC_INTERVAL_MS);
}
