/**
 * BullMQ processor: LLM spend sync dispatcher (fan-out).
 *
 * Runs every 30s. Queries active orgs and enqueues a per-org sync job for each.
 */

import { env } from "@proliferate/environment/server";
import type { Logger } from "@proliferate/logger";
import type {
	BillingLLMSyncDispatchJob,
	BillingLLMSyncOrgJob,
	Job,
	Queue,
} from "@proliferate/queue";
import { billing } from "@proliferate/services";

export async function processLLMSyncDispatchJob(
	_job: Job<BillingLLMSyncDispatchJob>,
	llmSyncOrgQueue: Queue<BillingLLMSyncOrgJob>,
	logger: Logger,
): Promise<void> {
	// Guard: REST API requires an admin-capable URL + master key
	const proxyUrl = env.LLM_PROXY_ADMIN_URL || env.LLM_PROXY_URL;
	if (!proxyUrl || !env.LLM_PROXY_MASTER_KEY) {
		return;
	}

	try {
		const orgIds = await billing.listBillableOrgIds();
		if (!orgIds.length) {
			logger.debug("No billable orgs for LLM sync");
			return;
		}

		logger.info({ orgCount: orgIds.length }, "Dispatching LLM sync jobs");

		for (const orgId of orgIds) {
			await llmSyncOrgQueue.add(`llm-sync:${orgId}`, { orgId });
		}
	} catch (err) {
		logger.error({ err }, "LLM sync dispatch failed");
		throw err;
	}
}
