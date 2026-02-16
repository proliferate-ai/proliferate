/**
 * BullMQ processor: compute metering.
 *
 * Runs every 30s. Bills all running sessions for elapsed compute time.
 */

import type { Logger } from "@proliferate/logger";
import type { Job } from "@proliferate/queue";
import type { BillingMeteringJob } from "@proliferate/queue";
import { billing } from "@proliferate/services";
import { getProvidersMap } from "./providers";

export async function processMeteringJob(
	_job: Job<BillingMeteringJob>,
	logger: Logger,
): Promise<void> {
	try {
		const providers = await getProvidersMap();
		await billing.runMeteringCycle(providers);
	} catch (err) {
		logger.error({ err }, "Metering cycle error");
		throw err;
	}
}
