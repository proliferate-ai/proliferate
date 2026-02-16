/**
 * BullMQ processor: billing outbox.
 *
 * Runs every 60s. Retries failed Autumn API calls.
 */

import type { Logger } from "@proliferate/logger";
import type { Job } from "@proliferate/queue";
import type { BillingOutboxJob } from "@proliferate/queue";
import { billing } from "@proliferate/services";

export async function processOutboxJob(_job: Job<BillingOutboxJob>, logger: Logger): Promise<void> {
	try {
		await billing.processOutbox();
	} catch (err) {
		logger.error({ err }, "Outbox processing error");
		throw err;
	}
}
